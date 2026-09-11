import type { LucideIcon } from "lucide-react";
import { Activity, BookOpenCheck, CircleHelp, FileText, LayoutDashboard, ListChecks, MessagesSquare, Upload } from "lucide-react";

/**
 * One hue per area of the product. Actions keep the single teal accent; these
 * only identify *where* you are, so a page is recognisable before you read it.
 */
export type Hue = "accent" | "docs" | "review" | "ask" | "evals" | "runs";

/** Complete class strings, so Tailwind sees them at build time. */
export const HUE: Record<Hue, { fg: string; soft: string; border: string; solid: string }> = {
  accent: { fg: "text-[var(--accent)]", soft: "bg-[var(--accent-soft)]", border: "border-[var(--accent-border)]", solid: "bg-[var(--accent)]" },
  docs: { fg: "text-[var(--sec-docs)]", soft: "bg-[var(--sec-docs-soft)]", border: "border-[var(--sec-docs-border)]", solid: "bg-[var(--sec-docs)]" },
  review: { fg: "text-[var(--sec-review)]", soft: "bg-[var(--sec-review-soft)]", border: "border-[var(--sec-review-border)]", solid: "bg-[var(--sec-review)]" },
  ask: { fg: "text-[var(--sec-ask)]", soft: "bg-[var(--sec-ask-soft)]", border: "border-[var(--sec-ask-border)]", solid: "bg-[var(--sec-ask)]" },
  evals: { fg: "text-[var(--sec-evals)]", soft: "bg-[var(--sec-evals-soft)]", border: "border-[var(--sec-evals-border)]", solid: "bg-[var(--sec-evals)]" },
  runs: { fg: "text-[var(--sec-runs)]", soft: "bg-[var(--sec-runs-soft)]", border: "border-[var(--sec-runs-border)]", solid: "bg-[var(--sec-runs)]" },
};

export type SectionKey = "overview" | "upload" | "documents" | "review" | "ask" | "evals" | "runs" | "help";

export type Section = {
  key: SectionKey;
  label: string;
  href: string;
  icon: LucideIcon;
  hue: Hue;
  /** One sentence a first-time user needs: what this area is for. */
  blurb: string;
};

export const SECTIONS: Record<SectionKey, Section> = {
  overview: { key: "overview", label: "Overview", href: "/", icon: LayoutDashboard, hue: "accent", blurb: "Where the workspace stands and what needs you next." },
  upload: { key: "upload", label: "Upload", href: "/upload", icon: Upload, hue: "accent", blurb: "Add PDF or DOCX files. They are hashed, versioned and processed automatically." },
  documents: { key: "documents", label: "Documents", href: "/documents", icon: FileText, hue: "docs", blurb: "Every edition of every document, with each extracted value linked to its source." },
  review: { key: "review", label: "Review queue", href: "/review", icon: ListChecks, hue: "review", blurb: "Values the pipeline could not approve on its own, with the evidence to decide." },
  ask: { key: "ask", label: "Ask & draft", href: "/ask", icon: MessagesSquare, hue: "ask", blurb: "Questions and drafts answered only from your documents, with checked citations." },
  evals: { key: "evals", label: "Evaluations", href: "/evals", icon: BookOpenCheck, hue: "evals", blurb: "The golden suite that measures quality and blocks regressions." },
  runs: { key: "runs", label: "Run activity", href: "/runs", icon: Activity, hue: "runs", blurb: "Every processing run: steps, retries, failures, tokens and cost." },
  help: { key: "help", label: "How it works", href: "/how-it-works", icon: CircleHelp, hue: "accent", blurb: "The flow from upload to evaluation, and where each thing lives." },
};

/** Navigation follows the order work actually flows through the product. */
export const NAV_ORDER: SectionKey[] = ["overview", "upload", "documents", "review", "ask", "evals", "runs"];

/** Which section a pathname belongs to, for highlighting and page identity. */
export function sectionForPath(pathname: string): SectionKey {
  if (pathname === "/") return "overview";
  if (pathname.startsWith("/rag") || pathname.startsWith("/ask")) return "ask";
  if (pathname.startsWith("/how-it-works")) return "help";
  for (const key of NAV_ORDER) {
    const href = SECTIONS[key].href;
    if (href !== "/" && (pathname === href || pathname.startsWith(`${href}/`))) return key;
  }
  return "overview";
}
