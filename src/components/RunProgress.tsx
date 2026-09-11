"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, ListChecks, MessagesSquare } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

export type ProgressStep = { name: string; status: string };
export type ProgressDoc = {
  versionId: string;
  documentId: string;
  logicalKey: string;
  displayName: string;
  versionNumber: number;
  processingStatus: string;
  steps: ProgressStep[];
  succeeded: number;
  failed: boolean;
  currentStep: string | null;
};
export type Progress = {
  id: string;
  status: string;
  documentsTotal: number;
  documentsCompleted: number;
  documentsFailed: number;
  reviewItemsCreated: number;
  retries: number;
  totalSteps: number;
  documents: ProgressDoc[];
};

const STEP_LABEL: Record<string, string> = {
  parse: "Parsing",
  chunk: "Chunking",
  extract: "Extracting with evidence",
  deterministic_validate: "Validating",
  independent_verify: "Verifying with a second model",
  calculate_confidence: "Scoring confidence",
  route_review: "Routing to review",
  embed: "Embedding",
  finalize: "Finalizing",
};
const TERMINAL = new Set(["completed", "completed_with_review", "failed"]);

/**
 * Live view of a processing run: one bar per document, one segment per step,
 * polled every two seconds until the run reaches a terminal state. When it
 * finishes it says what to do next instead of just stopping.
 */
export function RunProgress({ runId, initial = null, className = "" }: { runId: string; initial?: Progress | null; className?: string }) {
  const [p, setP] = useState<Progress | null>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial && TERMINAL.has(initial.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const res = await fetch(`/api/runs/${runId}/progress`, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 401 ? "Sign in to follow this run." : `Progress unavailable (HTTP ${res.status}).`);
        const data = (await res.json()) as Progress;
        if (cancelled) return;
        setP(data);
        setError(null);
        if (!TERMINAL.has(data.status)) timer = setTimeout(tick, 2000);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Progress unavailable.");
        timer = setTimeout(tick, 4000);
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, initial]);

  const active = !p || !TERMINAL.has(p.status);
  const totalSegments = p ? p.documents.length * p.totalSteps : 0;
  const doneSegments = p ? p.documents.reduce((n, d) => n + d.succeeded, 0) : 0;
  const pct = totalSegments ? Math.round((doneSegments / totalSegments) * 100) : 0;

  return (
    <Panel className={cn("rise", className)} aria-live="polite">
      <PanelHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p ? (active ? `Processing ${p.documentsTotal} ${p.documentsTotal === 1 ? "document" : "documents"}` : p.status === "failed" ? "Processing failed" : `Processed ${p.documentsCompleted} of ${p.documentsTotal}`) : "Starting the run"}
            {p ? <StatusBadge status={p.status} size="sm" /> : null}
            {active ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--info)]">
                <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
                Live
              </span>
            ) : null}
          </span>
        }
        description={error ? <span className="text-[var(--bad)]">{error}</span> : active ? "Each document moves through nine durable steps. Retries reuse completed steps." : p?.reviewItemsCreated ? `${p.reviewItemsCreated} ${p.reviewItemsCreated === 1 ? "value was" : "values were"} flagged for a human decision.` : "Every value was auto-approved with evidence."}
        actions={
          <span className="tnum text-[12.5px] text-[var(--muted)]" title={`${doneSegments} of ${totalSegments} steps`}>
            {pct}%
          </span>
        }
      />

      {/* Overall bar */}
      <div className="h-1.5 w-full bg-[var(--surface-sunken)]" aria-hidden>
        <div className={cn("h-full bg-[var(--accent)] transition-[width] duration-500", active && "shimmer")} style={{ width: `${pct}%` }} />
      </div>

      <PanelBody padded={false}>
        {!p ? (
          <div className="px-4 py-3 text-[13px] text-[var(--muted)]">Connecting…</div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {p.documents.map((d) => (
              <li key={d.versionId} className="grid gap-x-4 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] sm:items-center">
                <div className="min-w-0">
                  <Link href={`/documents/${d.documentId}/versions/${d.versionId}`} className="block truncate text-[13px] font-medium transition-colors hover:text-[var(--accent)]" title={d.displayName}>
                    {d.displayName}
                  </Link>
                  <span className="font-mono text-[11.5px] text-[var(--muted)]">
                    {d.logicalKey} v{d.versionNumber}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex gap-0.5" role="img" aria-label={`${d.succeeded} of ${p.totalSteps} steps done`}>
                    {d.steps.map((s) => (
                      <span
                        key={s.name}
                        title={`${STEP_LABEL[s.name] ?? s.name}: ${s.status}`}
                        className={cn(
                          "h-1.5 flex-1 rounded-full transition-colors",
                          s.status === "succeeded" || s.status === "skipped" ? "bg-[var(--accent)]" : s.status === "running" ? "animate-pulse bg-[var(--info)]" : s.status === "failed" || s.status === "dead_letter" ? "bg-[var(--bad)]" : "bg-[var(--line)]",
                        )}
                      />
                    ))}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
                    {d.failed ? (
                      <>
                        <CircleAlert size={13} aria-hidden className="text-[var(--bad)]" />
                        <span className="text-[var(--bad)]">Failed at {STEP_LABEL[d.steps.find((s) => s.status === "failed" || s.status === "dead_letter")?.name ?? ""]?.toLowerCase() ?? "a step"}</span>
                      </>
                    ) : d.succeeded >= p.totalSteps ? (
                      <>
                        <CheckCircle2 size={13} aria-hidden className="text-[var(--ok)]" />
                        <span>Done</span>
                      </>
                    ) : (
                      <span className="truncate">{d.currentStep ? `${STEP_LABEL[d.currentStep] ?? d.currentStep}…` : "Queued"}</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>

      {p && !active ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] bg-[var(--surface-sunken)] px-4 py-2.5">
          {p.reviewItemsCreated > 0 ? (
            <Button asChild size="sm">
              <Link href="/review">
                <ListChecks size={14} aria-hidden />
                Review {p.reviewItemsCreated} flagged {p.reviewItemsCreated === 1 ? "value" : "values"}
              </Link>
            </Button>
          ) : null}
          <Button asChild variant={p.reviewItemsCreated > 0 ? "secondary" : "primary"} size="sm">
            <Link href="/ask">
              <MessagesSquare size={14} aria-hidden />
              Ask about these documents
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="ml-auto">
            <Link href={`/runs/${p.id}`}>
              Run details
              <ArrowRight size={13} aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
