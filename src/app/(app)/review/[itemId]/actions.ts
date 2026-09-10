"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { coerceReviewValue, resolveReviewItem, ReviewConflictError, type ReviewActionKind } from "@/lib/review/actions";
import { nextOpenReviewItemId } from "@/lib/queries/review";
import { canReview, requireWorkspace } from "@/lib/workspace";

export type ReviewFormState = { error: string } | null;

const ACTIONS: ReviewActionKind[] = ["accept", "edit_accept", "reject", "needs_source"];

const LABEL: Record<ReviewActionKind, string> = {
  accept: "Accepted",
  edit_accept: "Edited and accepted",
  reject: "Rejected",
  needs_source: "Marked as needing more source",
};

export async function resolveReviewAction(_prev: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  const { user, workspace } = await requireWorkspace();
  if (!canReview(workspace.role)) return { error: "Your role cannot resolve review items." };

  const reviewItemId = String(formData.get("reviewItemId") ?? "");
  const actionRaw = String(formData.get("action") ?? "");
  const fieldPath = String(formData.get("fieldPath") ?? "");
  const expectedRecordVersionId = String(formData.get("expectedRecordVersionId") ?? "") || null;
  const rawValue = String(formData.get("newValue") ?? "");
  const commentRaw = String(formData.get("comment") ?? "").trim();
  if (!reviewItemId || !ACTIONS.includes(actionRaw as ReviewActionKind)) return { error: "Invalid review action." };
  const action = actionRaw as ReviewActionKind;

  let newValue: unknown;
  if (action === "edit_accept") {
    if (rawValue.trim() === "") return { error: "Enter a value before using Edit & Accept." };
    try {
      newValue = coerceReviewValue(fieldPath, rawValue);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  let flash: string;
  try {
    const result = await resolveReviewItem({ reviewItemId, reviewerUserId: user.id, action, newValue, comment: commentRaw || null, expectedRecordVersionId });
    flash = result.resultingVersionNumber !== null ? `${LABEL[action]} ${fieldPath}; record version ${result.resultingVersionNumber} created.` : `${LABEL[action]} ${fieldPath}.`;
  } catch (err) {
    if (err instanceof ReviewConflictError) return { error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  }

  revalidatePath("/review");
  revalidatePath(`/review/${reviewItemId}`);
  revalidatePath("/");
  const next = await nextOpenReviewItemId(workspace.workspaceId, reviewItemId);
  redirect(next ? `/review/${next}?flash=${encodeURIComponent(flash)}` : `/review?flash=${encodeURIComponent(`${flash} No open items remain.`)}`);
}
