import { jobsConfigured } from "@/lib/env";
import Link from "next/link";
import { isAdmin, requireWorkspace } from "@/lib/workspace";
import { listEvalRuns, metricsOf } from "@/lib/queries/evals";
import { latestCorpusRun } from "@/lib/eval/corpus";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { FormButton } from "@/components/FormButton";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtDate, fmtDuration, fmtPct, shortId } from "@/components/format";
import { runEvaluationAction } from "./actions";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function EvalsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const { workspace } = await requireWorkspace();
  const [runs, corpusRun] = await Promise.all([listEvalRuns(workspace.workspaceId), latestCorpusRun(workspace.workspaceId)]);
  const admin = isAdmin(workspace.role) && jobsConfigured();
  const error = one(sp.error);

  return (
    <>
      <PageHeader
        title="Evaluations"
        subtitle="Golden suite runs: extraction accuracy, review routing, retrieval, cited answers, refusals and integrity, compared against the baseline."
        actions={
          admin ? (
            <form action={runEvaluationAction} className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted)]">{corpusRun ? <>attaches run <Mono title={corpusRun.id}>{shortId(corpusRun.id)}</Mono></> : "no corpus run yet"}</span>
              <FormButton pendingText="Running the suite, this can take a minute..." title="Runs every active eval case against the current corpus">
                Run evaluation
              </FormButton>
            </form>
          ) : (
            <span className="text-xs text-[var(--muted)]">Running evaluations requires the admin role</span>
          )
        }
      />
      {error ? <div className="mb-3 rounded border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,white)] px-3 py-1.5 text-sm text-[var(--bad)]">{error}</div> : null}

      <Table>
        <THead>
          <Th>Run</Th>
          <Th>Provider</Th>
          <Th>Config</Th>
          <Th>Status</Th>
          <Th align="right">Cases</Th>
          <Th align="right">Scalar acc.</Th>
          <Th align="right">List F1</Th>
          <Th align="right">Evidence</Th>
          <Th align="right">Review recall</Th>
          <Th align="right">Recall@5</Th>
          <Th align="right">Citation prec.</Th>
          <Th align="right">Refusal acc.</Th>
          <Th align="right">Semantic</Th>
          <Th>Regression</Th>
          <Th>Baseline</Th>
          <Th>Started</Th>
          <Th align="right">Duration</Th>
        </THead>
        <tbody>
          {runs.length === 0 ? <TableEmpty colSpan={17}>No evaluation runs yet.</TableEmpty> : null}
          {runs.map((r) => {
            const m = metricsOf(r);
            const duration = r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null;
            return (
              <Tr key={r.id}>
                <Td>
                  <Link href={`/evals/${r.id}`} className="text-[var(--accent)] underline">
                    <Mono title={r.id}>{shortId(r.id)}</Mono>
                  </Link>
                  {r.processingRunId ? (
                    <div className="text-xs text-[var(--muted)]">
                      run{" "}
                      <Link href={`/runs/${r.processingRunId}`} className="underline">
                        <Mono>{shortId(r.processingRunId)}</Mono>
                      </Link>
                    </div>
                  ) : null}
                </Td>
                <Td>{r.provider}</Td>
                <Td>
                  <Mono title={r.modelConfigHash}>{shortId(r.modelConfigHash)}</Mono>
                </Td>
                <Td>
                  <StatusBadge status={r.status} title={r.errorMessage ?? undefined} />
                </Td>
                <Td align="right">{m ? `${m.cases.passed} / ${m.cases.total}` : ""}</Td>
                <Td align="right">{m ? fmtPct(m.extraction.scalar_exact_accuracy, 1) : ""}</Td>
                <Td align="right">{m ? fmtPct(m.extraction.list_micro_f1, 1) : ""}</Td>
                <Td align="right">{m ? fmtPct(m.extraction.provenance_validity, 1) : ""}</Td>
                <Td align="right">{m ? fmtPct(m.review.recall, 1) : ""}</Td>
                <Td align="right">{m ? fmtPct(m.rag.retrieval_recall_at_5, 1) : ""}</Td>
                <Td align="right">{m ? fmtPct(m.rag.citation_precision, 1) : ""}</Td>
                <Td align="right">{m ? fmtPct(m.rag.refusal_accuracy, 1) : ""}</Td>
                <Td align="right">{m ? m.rag.semantic_score.toFixed(3) : ""}</Td>
                <Td>{r.regressionPassed === null ? <span className="text-[var(--muted)]">-</span> : <StatusBadge status={r.regressionPassed ? "pass" : "fail"} title="regression rules" />}</Td>
                <Td>{r.isBaseline ? <StatusBadge status="accepted" title="baseline run" /> : ""}</Td>
                <Td>
                  <Mono>{fmtDate(r.startedAt, true)}</Mono>
                </Td>
                <Td align="right">{fmtDuration(duration)}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
