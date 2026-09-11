import type { WorkflowSnapshot } from "@/lib/queries/workflow";
import { SECTIONS, type Hue, type SectionKey } from "@/lib/sections";
import type { LucideIcon } from "lucide-react";

export type StageState = "idle" | "running" | "attention" | "done";

export type Stage = {
  key: SectionKey;
  label: string;
  href: string;
  hue: Hue;
  icon: LucideIcon;
  /** The one number that matters for this stage right now. */
  value: string;
  caption: string;
  state: StageState;
};

export type NextAction = {
  title: string;
  body: string;
  href: string;
  cta: string;
  hue: Hue;
  /** Whether the CTA performs work (upload, review, ask) or just navigates. */
  kind: "act" | "look";
};

export type Perms = { canUpload: boolean; canReview: boolean; canAsk: boolean; canEvaluate: boolean };

/** Stage names are verbs: the strip reads as what happens, and links to where it happens. */
const STAGE_LABEL: Partial<Record<SectionKey, string>> = { upload: "Upload", documents: "Extract", review: "Review", ask: "Ask", evals: "Evaluate" };

function stage(key: SectionKey, value: string, caption: string, state: StageState): Stage {
  const s = SECTIONS[key];
  return { key, label: STAGE_LABEL[key] ?? s.label, href: s.href, hue: s.hue, icon: s.icon, value, caption, state };
}

/** The five stages, read left to right, each with its live state. */
export function buildStages(w: WorkflowSnapshot): Stage[] {
  const uploaded = w.documents > 0;
  const extract: StageState = w.versionsProcessing > 0 ? "running" : w.versionsFailed > 0 ? "attention" : w.versionsCompleted > 0 ? "done" : "idle";
  const review: StageState = w.openReview > 0 ? "attention" : w.resolvedReview > 0 || w.versionsCompleted > 0 ? "done" : "idle";
  const evalState: StageState = !w.latestEval ? "idle" : w.latestEval.status === "running" ? "running" : w.latestEval.regressionPassed === false ? "attention" : "done";

  return [
    stage("upload", String(w.documents), uploaded ? `${w.versions} ${w.versions === 1 ? "version" : "versions"} kept` : "Nothing uploaded yet", uploaded ? "done" : "idle"),
    stage(
      "documents",
      w.versionsProcessing > 0 ? `${w.versionsProcessing}` : `${w.versionsCompleted}`,
      w.versionsProcessing > 0 ? "versions processing now" : w.versionsFailed > 0 ? `${w.versionsFailed} failed` : w.versionsCompleted > 0 ? "versions extracted with evidence" : "Waiting for an upload",
      extract,
    ),
    stage("review", String(w.openReview), w.openReview > 0 ? "need a decision" : w.resolvedReview > 0 ? `${w.resolvedReview} decided` : "Nothing flagged", review),
    stage("ask", String(w.questions), w.questions > 0 ? "questions answered" : "Ask anything about the corpus", w.questions > 0 ? "done" : "idle"),
    stage(
      "evals",
      w.evalRuns > 0 ? (w.latestEval?.regressionPassed === false ? "Fail" : w.latestEval?.status === "running" ? "…" : "Pass") : "—",
      w.evalRuns > 0 ? `${w.evalRuns} ${w.evalRuns === 1 ? "run" : "runs"} recorded` : "Not measured yet",
      evalState,
    ),
  ];
}

/** The single most useful thing to do next, given what the workspace looks like and what this user may do. */
export function nextAction(w: WorkflowSnapshot, p: Perms): NextAction {
  if (w.documents === 0) {
    return p.canUpload
      ? { title: "Upload your first documents", body: "Drop in a PDF or DOCX. Every value it extracts will cite the page it came from.", href: "/upload", cta: "Upload documents", hue: "accent", kind: "act" }
      : { title: "This workspace is empty", body: "Nothing has been uploaded yet. Ask an admin or reviewer to add the first documents.", href: "/how-it-works", cta: "See how it works", hue: "accent", kind: "look" };
  }
  if (w.activeRun) {
    return { title: "Documents are being processed", body: "Parsing, extraction, verification and scoring are running now. Watch each step land.", href: `/runs/${w.activeRun.id}`, cta: "Watch the run", hue: "runs", kind: "look" };
  }
  if (w.versionsFailed > 0 && w.openReview === 0) {
    return { title: `${w.versionsFailed} ${w.versionsFailed === 1 ? "document" : "documents"} failed to process`, body: "Open run activity to see which step failed and retry it from the dead letter.", href: "/runs", cta: "Inspect failures", hue: "runs", kind: "look" };
  }
  if (w.openReview > 0) {
    const n = `${w.openReview} ${w.openReview === 1 ? "value needs" : "values need"} a decision`;
    return p.canReview && w.firstOpenReviewId
      ? { title: n, body: "Highest priority first. Each one shows the source quote, the verifier's view and why it was flagged.", href: `/review/${w.firstOpenReviewId}`, cta: "Start reviewing", hue: "review", kind: "act" }
      : { title: n, body: "Open the queue to see the evidence behind each flagged value.", href: "/review", cta: "Open the queue", hue: "review", kind: "look" };
  }
  if (w.questions === 0) {
    return { title: "Ask the corpus a question", body: "Answers are built only from retrieved source blocks and every claim carries a checked citation.", href: "/ask", cta: p.canAsk ? "Ask a question" : "See how answers work", hue: "ask", kind: p.canAsk ? "act" : "look" };
  }
  if (w.evalRuns === 0) {
    return p.canEvaluate
      ? { title: "Measure quality with the golden suite", body: "146 committed cases score extraction, provenance, retrieval, citations and refusals. The first run becomes the baseline.", href: "/evals", cta: "Run evaluation", hue: "evals", kind: "act" }
      : { title: "Quality has not been measured yet", body: "An admin can run the golden suite to establish a baseline for this workspace.", href: "/evals", cta: "See evaluations", hue: "evals", kind: "look" };
  }
  if (w.latestEval?.regressionPassed === false) {
    return { title: "The latest evaluation regressed", body: "One or more metrics fell below the baseline. Open the run to see which cases failed.", href: `/evals/${w.latestEval.id}`, cta: "Inspect the regression", hue: "evals", kind: "look" };
  }
  return { title: "All clear", body: "Nothing is waiting on you. Upload more documents, ask a question, or re-run the suite after a change.", href: p.canUpload ? "/upload" : "/ask", cta: p.canUpload ? "Upload more" : "Ask a question", hue: "accent", kind: "act" };
}

/** Getting-started steps, derived from data so they never drift from reality. */
export function guideSteps(w: WorkflowSnapshot): { key: string; label: string; detail: string; href: string; done: boolean }[] {
  return [
    { key: "upload", label: "Upload a document", detail: "PDF or DOCX, up to 20 at a time.", href: "/upload", done: w.documents > 0 },
    { key: "extract", label: "See what was extracted", detail: "Every field with its source quote and confidence.", href: "/documents", done: w.versionsCompleted > 0 },
    { key: "review", label: "Decide a flagged value", detail: "Accept, edit or reject with the evidence in front of you.", href: w.firstOpenReviewId ? `/review/${w.firstOpenReviewId}` : "/review", done: w.resolvedReview > 0 },
    { key: "ask", label: "Ask a question", detail: "Cited answers, refusals when the corpus cannot say.", href: "/ask", done: w.questions > 0 },
    { key: "evals", label: "Run the golden suite", detail: "Establish a quality baseline and catch regressions.", href: "/evals", done: w.evalRuns > 0 },
  ];
}
