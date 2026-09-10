import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { resolveReviewItem } from "@/lib/review/actions";
import type { SeedResult } from "@/lib/seed";

/** A documented synthetic reviewer decision, confined to the known Orchard Valley fixture. */
export async function seedDemoReview(seed: SeedResult) {
  const [row] = await getDb().select({ item: schema.reviewItems, field: schema.fieldValues })
    .from(schema.reviewItems).innerJoin(schema.fieldValues, eq(schema.fieldValues.id, schema.reviewItems.fieldValueId))
    .innerJoin(schema.documentVersions, eq(schema.documentVersions.id, schema.reviewItems.documentVersionId))
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(and(eq(schema.reviewItems.workspaceId, seed.workspaceId), eq(schema.documents.logicalKey, "AUD-2026-003"), eq(schema.documentVersions.versionNumber, 1), eq(schema.reviewItems.fieldPath, "monetary_amounts[0]"), eq(schema.reviewItems.status, "open"))).limit(1);
  if (!row) return null;
  const [previous] = await getDb().select().from(schema.reviewActions).where(eq(schema.reviewActions.reviewItemId, row.item.id)).limit(1);
  if (previous) return null;
  const candidate = row.field.valueJson as Record<string, unknown>;
  return resolveReviewItem({ reviewItemId: row.item.id, reviewerUserId: seed.reviewerId, action: "edit_accept", newValue: { ...candidate, amount: 512000 }, comment: "Synthetic demonstration decision: the reconciliation paragraph revises the recoverable amount to USD 512,000. Original extraction preserved in record history." });
}
