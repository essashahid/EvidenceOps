"use server";

import { assertMutation } from "@/lib/access";

import { redirect } from "next/navigation";
import { askQuestion } from "@/lib/rag/answer";
import { ANSWER_MODES, type AnswerMode } from "@/lib/db/schema";
import { requireWorkspace } from "@/lib/workspace";

export async function askAction(formData: FormData): Promise<void> {
  const context = await requireWorkspace();
  await assertMutation(context, "rag", ["admin", "reviewer"]);
  const { user, workspace } = context;
  const question = String(formData.get("question") ?? "").trim();
  const modeRaw = String(formData.get("mode") ?? "answer");
  const mode: AnswerMode = (ANSWER_MODES as readonly string[]).includes(modeRaw) ? (modeRaw as AnswerMode) : "answer";
  const includeSuperseded = formData.get("includeSuperseded") === "on";
  if (!question) redirect(`/ask?error=${encodeURIComponent("Enter a question first.")}`);
  if (question.length > 2000) redirect(`/ask?error=${encodeURIComponent("Questions are limited to 2000 characters.")}`);

  let answerId: string;
  try {
    const result = await askQuestion({ workspaceId: workspace.workspaceId, userId: user.id, question, mode, includeSuperseded });
    answerId = result.answerId;
  } catch (err) {
    redirect(`/ask?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
  redirect(`/ask?answer=${answerId}`);
}
