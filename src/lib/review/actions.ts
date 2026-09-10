import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { reportRecordSchema, setFieldValue, type ReportRecord } from "@/lib/schema/report";

export type ReviewActionKind = "accept" | "edit_accept" | "reject" | "needs_source";

export class ReviewConflictError extends Error {
  constructor(message = "This review item was already resolved by another reviewer.") {
    super(message);
    this.name = "ReviewConflictError";
  }
}

export type ResolveInput = {
  reviewItemId: string;
  reviewerUserId: string;
  action: ReviewActionKind;
  newValue?: unknown;
  comment?: string | null;
  /** Optimistic concurrency: the record version the reviewer was looking at. */
  expectedRecordVersionId?: string | null;
};

export type ResolveResult = {
  reviewItemId: string;
  action: ReviewActionKind;
  resultingRecordVersionId: string | null;
  resultingVersionNumber: number | null;
};

/**
 * Resolve one review item. Accept / edit-accept / reject create a NEW immutable record version
 * (the model output is never overwritten); needs-source leaves the item unresolved and flags it.
 * Concurrency: the item is claimed with `UPDATE ... WHERE status = 'open'`, so a second reviewer's
 * write is rejected, and the record version the reviewer saw must still be current.
 */
export async function resolveReviewItem(input: ResolveInput): Promise<ResolveResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const newStatus = input.action === "needs_source" ? "needs_source" : input.action === "reject" ? "rejected" : "resolved";
    const [item] = await tx
      .update(schema.reviewItems)
      .set({ status: newStatus, resolvedBy: input.reviewerUserId, resolvedAt: new Date() })
      .where(and(eq(schema.reviewItems.id, input.reviewItemId), eq(schema.reviewItems.status, "open")))
      .returning();
    if (!item) throw new ReviewConflictError();

    const [current] = await tx
      .select()
      .from(schema.recordVersions)
      .where(and(eq(schema.recordVersions.documentVersionId, item.documentVersionId), eq(schema.recordVersions.isCurrent, true)))
      .orderBy(desc(schema.recordVersions.versionNumber))
      .limit(1);
    if (!current) throw new Error("no current record version for this document");
    if (input.expectedRecordVersionId && input.expectedRecordVersionId !== current.id) {
      throw new ReviewConflictError("The record changed while you were reviewing it. Reload and try again.");
    }

    const currentFields = await tx.select().from(schema.fieldValues).where(eq(schema.fieldValues.recordVersionId, current.id)).orderBy(asc(schema.fieldValues.createdAt));
    const target = currentFields.find((f) => f.fieldPath === item.fieldPath);
    if (!target) throw new Error(`field ${item.fieldPath} not found on the current record version`);
    const oldValue = target.valueJson;

    if (input.action === "needs_source") {
      await tx.insert(schema.reviewActions).values({
        reviewItemId: item.id,
        reviewerUserId: input.reviewerUserId,
        action: "needs_source",
        oldValueJson: oldValue as object,
        newValueJson: null,
        comment: input.comment ?? null,
        resultingRecordVersionId: null,
      });
      await tx.update(schema.fieldValues).set({ routingStatus: "needs_source" }).where(eq(schema.fieldValues.id, target.id));
      return { reviewItemId: item.id, action: input.action, resultingRecordVersionId: null, resultingVersionNumber: null };
    }

    const payload = reportRecordSchema.parse(current.payloadJson) as ReportRecord;
    let newValue: unknown = oldValue;
    let routing: "accepted" | "rejected" = "accepted";
    if (input.action === "edit_accept") {
      if (input.newValue === undefined) throw new Error("edit_accept requires a value");
      newValue = input.newValue;
    } else if (input.action === "reject") {
      newValue = null;
      routing = "rejected";
    }
    const nextPayload = input.action === "accept" ? payload : setFieldValue(payload, item.fieldPath, newValue);
    const changedFields = input.action === "accept" ? [] : [item.fieldPath];

    await tx.update(schema.recordVersions).set({ isCurrent: false }).where(eq(schema.recordVersions.documentVersionId, item.documentVersionId));
    const [next] = await tx
      .insert(schema.recordVersions)
      .values({
        documentVersionId: item.documentVersionId,
        extractionRunId: current.extractionRunId,
        parentRecordVersionId: current.id,
        versionNumber: current.versionNumber + 1,
        createdByType: "reviewer",
        createdByUserId: input.reviewerUserId,
        modelConfigHash: current.modelConfigHash,
        payloadJson: nextPayload,
        changedFields,
        isCurrent: true,
      })
      .returning();

    // Copy every field value (and its evidence) into the new version so each version is self-contained.
    for (const f of currentFields) {
      const isTarget = f.id === target.id;
      const [copied] = await tx
        .insert(schema.fieldValues)
        .values({
          recordVersionId: next!.id,
          fieldPath: f.fieldPath,
          valueJson: (isTarget ? newValue : f.valueJson) as object,
          isRequired: f.isRequired,
          confidence: f.confidence,
          routingStatus: isTarget ? routing : f.routingStatus,
          deterministicValidation: f.deterministicValidation,
          evidenceExactMatch: f.evidenceExactMatch,
          verifierSupport: f.verifierSupport,
          crossPassAgreement: f.crossPassAgreement,
          evidenceSpecificity: f.evidenceSpecificity,
          verifierStatus: f.verifierStatus,
          contradiction: f.contradiction,
          verifierCorrectedValueJson: f.verifierCorrectedValueJson as object,
          validationMessages: f.validationMessages,
        })
        .returning({ id: schema.fieldValues.id });
      await tx.execute(sql`
        insert into field_evidence (field_value_id, source_block_id, quote_text, quote_start, quote_end, source_locator, exact_match)
        select ${copied!.id}, source_block_id, quote_text, quote_start, quote_end, source_locator, exact_match
        from field_evidence where field_value_id = ${f.id}
      `);
    }

    await tx.insert(schema.reviewActions).values({
      reviewItemId: item.id,
      reviewerUserId: input.reviewerUserId,
      action: input.action,
      oldValueJson: oldValue as object,
      newValueJson: newValue as object,
      comment: input.comment ?? null,
      resultingRecordVersionId: next!.id,
    });

    // If no review items remain open for this version, flip the document to completed.
    const [openRow] = await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(schema.reviewItems)
      .where(and(eq(schema.reviewItems.documentVersionId, item.documentVersionId), eq(schema.reviewItems.status, "open")));
    if ((openRow?.open ?? 0) === 0) {
      await tx
        .update(schema.documentVersions)
        .set({ processingStatus: "completed" })
        .where(and(eq(schema.documentVersions.id, item.documentVersionId), eq(schema.documentVersions.processingStatus, "completed_with_review")));
    }
    return { reviewItemId: item.id, action: input.action, resultingRecordVersionId: next!.id, resultingVersionNumber: next!.versionNumber };
  });
}

/** Coerce a reviewer-entered string into the field's value type. */
export function coerceReviewValue(fieldPath: string, raw: string): unknown {
  const leaf = fieldPath.replace(/^.*\./, "");
  if (leaf === "amount") {
    const n = Number(raw.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) throw new Error("Amount must be a number");
    return n;
  }
  return raw.trim();
}
