import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { fixture, seeded, uploadAndProcess } from "./helpers";
import { ReviewConflictError, resolveReviewItem } from "@/lib/review/actions";
import { getReviewItemDetail, listReviewItems } from "@/lib/review/queries";
import { getFieldValue, reportRecordSchema } from "@/lib/schema/report";

let workspaceId = "";
let reviewerId = "";
let versionId = "";

beforeAll(async () => {
  const seed = await seeded();
  workspaceId = seed.workspaceId;
  reviewerId = seed.reviewerId;
  const file = "OPS-2026-004-v1-northstar-operational-review.pdf";
  const { result, up } = await uploadAndProcess(file, fixture(`corpus/${file}`));
  versionId = up.documentVersionId;
  expect(result.run?.status).toBe("completed_with_review");
});

describe("human review", () => {
  it("routes planted uncertain fields to review with evidence, context and component breakdown", async () => {
    const items = await listReviewItems(workspaceId, { status: "open", documentVersionId: versionId });
    expect(items.length).toBeGreaterThan(0);
    const detail = await getReviewItemDetail(workspaceId, items[0]!.item.id);
    expect(detail).not.toBeNull();
    expect(detail!.evidence?.sourceLocator).toMatch(/^SRC-OPS-2026-004-V1-P\d\d$/);
    expect(detail!.block).not.toBeNull();
    expect(detail!.context).not.toBeNull();
    expect(Number(detail!.field.confidence)).toBeLessThan(0.86);
    // every value below the auto-approval threshold has a review item
    const [record] = await getDb().select().from(schema.recordVersions).where(and(eq(schema.recordVersions.documentVersionId, versionId), eq(schema.recordVersions.isCurrent, true)));
    const fields = await getDb().select().from(schema.fieldValues).where(eq(schema.fieldValues.recordVersionId, record!.id));
    const all = await listReviewItems(workspaceId, { status: "all", documentVersionId: versionId });
    for (const f of fields.filter((x) => Number(x.confidence) < 0.86)) expect(all.some((i) => i.item.fieldValueId === f.id)).toBe(true);
  });

  it("edit & accept creates a new immutable record version and records the action", async () => {
    const items = await listReviewItems(workspaceId, { status: "open", documentVersionId: versionId });
    const target = items.find((i) => i.item.fieldPath.endsWith(".amount")) ?? items[0]!;
    const detail = await getReviewItemDetail(workspaceId, target.item.id);
    const before = await getDb().select().from(schema.recordVersions).where(eq(schema.recordVersions.documentVersionId, versionId));
    const newValue = target.item.fieldPath.endsWith(".amount") ? 424242 : "Reviewer corrected value";
    const res = await resolveReviewItem({ reviewItemId: target.item.id, reviewerUserId: reviewerId, action: "edit_accept", newValue, comment: "Appendix correction supersedes the summary figure.", expectedRecordVersionId: detail!.currentRecord!.id });
    expect(res.resultingRecordVersionId).toBeTruthy();
    const after = await getDb().select().from(schema.recordVersions).where(eq(schema.recordVersions.documentVersionId, versionId));
    expect(after).toHaveLength(before.length + 1);
    const current = after.find((r) => r.isCurrent)!;
    expect(current.id).toBe(res.resultingRecordVersionId);
    expect(current.createdByType).toBe("reviewer");
    expect(current.parentRecordVersionId).toBe(detail!.currentRecord!.id);
    expect(current.changedFields).toEqual([target.item.fieldPath]);
    expect(getFieldValue(reportRecordSchema.parse(current.payloadJson), target.item.fieldPath)).toEqual(newValue);
    // the model version is untouched
    const model = after.find((r) => r.id === detail!.currentRecord!.id)!;
    expect(model.isCurrent).toBe(false);
    expect(getFieldValue(reportRecordSchema.parse(model.payloadJson), target.item.fieldPath)).toEqual(detail!.field.valueJson);
    const [action] = await getDb().select().from(schema.reviewActions).where(eq(schema.reviewActions.reviewItemId, target.item.id));
    expect(action!.action).toBe("edit_accept");
    expect(action!.oldValueJson).toEqual(detail!.field.valueJson);
    expect(action!.newValueJson).toEqual(newValue);
    // the new version carries per-field state, with the target marked accepted
    const fields = await getDb().select().from(schema.fieldValues).where(eq(schema.fieldValues.recordVersionId, current.id));
    expect(fields.find((f) => f.fieldPath === target.item.fieldPath)!.routingStatus).toBe("accepted");
  });

  it("rejects a second write on the same item and stale record versions", async () => {
    const resolved = (await listReviewItems(workspaceId, { status: "resolved", documentVersionId: versionId }))[0]!;
    await expect(resolveReviewItem({ reviewItemId: resolved.item.id, reviewerUserId: reviewerId, action: "accept" })).rejects.toBeInstanceOf(ReviewConflictError);
    const open = (await listReviewItems(workspaceId, { status: "open", documentVersionId: versionId }))[0];
    if (open) {
      const stale = (await getDb().select().from(schema.recordVersions).where(eq(schema.recordVersions.documentVersionId, versionId))).find((r) => !r.isCurrent)!;
      await expect(resolveReviewItem({ reviewItemId: open.item.id, reviewerUserId: reviewerId, action: "accept", expectedRecordVersionId: stale.id })).rejects.toBeInstanceOf(ReviewConflictError);
    }
  });

  it("reject nulls the value; needs_source leaves the item unresolved", async () => {
    const open = await listReviewItems(workspaceId, { status: "open", documentVersionId: versionId });
    if (open.length >= 2) {
      const a = open[0]!;
      const r = await resolveReviewItem({ reviewItemId: a.item.id, reviewerUserId: reviewerId, action: "reject" });
      const [rv] = await getDb().select().from(schema.recordVersions).where(eq(schema.recordVersions.id, r.resultingRecordVersionId!));
      expect(getFieldValue(reportRecordSchema.parse(rv!.payloadJson), a.item.fieldPath)).toBeNull();
      const b = open[1]!;
      const r2 = await resolveReviewItem({ reviewItemId: b.item.id, reviewerUserId: reviewerId, action: "needs_source", comment: "Need the appendix." });
      expect(r2.resultingRecordVersionId).toBeNull();
      const [item] = await getDb().select().from(schema.reviewItems).where(eq(schema.reviewItems.id, b.item.id));
      expect(item!.status).toBe("needs_source");
    }
  });
});
