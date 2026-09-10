import { QualityTrend } from "@/components/QualityCharts";
import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { getDashboardStats, listRecentRuns } from "@/lib/queries/dashboard";
import { listDocuments } from "@/lib/queries/documents";
import { listEvalRuns, latestEvalRun, metricsOf, regressionOf } from "@/lib/queries/evals";
import { PageHeader, SectionHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtDate, fmtNumber, fmtPct, fmtUsd, shortId } from "@/components/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { workspace } = await requireWorkspace();
  const [stats, runs, docs, evalRun] = await Promise.all([getDashboardStats(workspace.workspaceId), listRecentRuns(workspace.workspaceId, 10), listDocuments(workspace.workspaceId, 10), latestEvalRun(workspace.workspaceId)]);
  const evalMetrics = evalRun ? metricsOf(evalRun) : null;
  const evalRegression = evalRun ? regressionOf(evalRun) : null;
  const history = await listEvalRuns(workspace.workspaceId, 8);
  const trend = history.toReversed().flatMap((r, i) => { const m = metricsOf(r); return m ? [{ name: `Run ${i+1}`, extraction: m.extraction.scalar_exact_accuracy * 100, citations: m.rag.citation_precision * 100, recall: m.rag.retrieval_recall_at_5 * 100 }] : []; });
  return (
    <>
      <PageHeader
        title="Workspace overview"
        subtitle="Production Document Intelligence & RAG Quality Workbench"
        actions={
          <>
            <NavButton href="/upload">Upload</NavButton>
            <NavButton href="/review">Review</NavButton>
            <NavButton href="/runs">Runs</NavButton>
            <NavButton href="/ask">Ask</NavButton>
            <NavButton href="/evals">Evals</NavButton>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Current documents" value={fmtNumber(stats.documents)} hint="logical document identities" />
        <StatCard label="Current source versions" value={fmtNumber(stats.documents)} hint={`${stats.versions} editions preserved`} />
        <StatCard label="Open review items" value={fmtNumber(stats.openReviewItems)} tone={stats.openReviewItems ? "warn" : "ok"} hint={<Link href="/review" className="underline">Inspect flagged evidence →</Link>} />
        <StatCard label="Extraction accuracy" value={evalMetrics ? fmtPct(evalMetrics.extraction.scalar_exact_accuracy, 1) : "—"} hint="latest evaluation · target ≥ 95%" tone="accent" />
        <StatCard label="Citation precision" value={evalMetrics ? fmtPct(evalMetrics.rag.citation_precision, 1) : "—"} hint="latest evaluation · target ≥ 95%" tone="accent" />
        <StatCard label="Latest run cost" value={runs[0] ? fmtUsd(runs[0].estimatedCostUsd) : "—"} hint="estimated provider usage" />
        <StatCard label="Latest run status" value={<span className="text-sm"><StatusBadge status={runs[0]?.status} /></span>} hint={`${stats.runsTotal} runs recorded`} />
        <StatCard label="Open failures" value={stats.deadLettersOpen} hint="dead letters requiring attention" tone={stats.deadLettersOpen ? "bad" : "ok"} />
      </div>
      <QualityTrend data={trend} />

      {evalRun ? (
        <>
          <SectionHeader
            title="Latest evaluation"
            actions={
              <Link href={`/evals/${evalRun.id}`} className="text-xs text-[var(--accent)] underline">
                Open eval run
              </Link>
            }
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <Link href={`/evals/${evalRun.id}`} className="text-[var(--accent)] underline">
                <Mono title={evalRun.id}>{shortId(evalRun.id)}</Mono>
              </Link>
              <StatusBadge status={evalRun.status} />
              {evalRun.isBaseline ? <StatusBadge status="accepted" title="baseline run" /> : null}
            </span>
            <span>
              regression{" "}
              {evalRun.regressionPassed === null ? <span className="text-[var(--muted)]">n/a</span> : <StatusBadge status={evalRun.regressionPassed ? "pass" : "fail"} title={evalRegression?.hasBaseline ? "compared against baseline" : "no baseline: absolute rules only"} />}
            </span>
            {evalMetrics ? (
              <>
                <span>
                  cases <span className="font-mono tabular-nums">{evalMetrics.cases.passed} / {evalMetrics.cases.total}</span>
                </span>
                <span>
                  scalar acc. <span className="font-mono tabular-nums">{fmtPct(evalMetrics.extraction.scalar_exact_accuracy, 1)}</span>
                </span>
                <span>
                  list F1 <span className="font-mono tabular-nums">{fmtPct(evalMetrics.extraction.list_micro_f1, 1)}</span>
                </span>
                <span>
                  evidence <span className="font-mono tabular-nums">{fmtPct(evalMetrics.extraction.provenance_validity, 1)}</span>
                </span>
                <span>
                  review recall <span className="font-mono tabular-nums">{fmtPct(evalMetrics.review.recall, 1)}</span>
                </span>
                <span>
                  recall@5 <span className="font-mono tabular-nums">{fmtPct(evalMetrics.rag.retrieval_recall_at_5, 1)}</span>
                </span>
                <span>
                  citation prec. <span className="font-mono tabular-nums">{fmtPct(evalMetrics.rag.citation_precision, 1)}</span>
                </span>
                <span>
                  refusal acc. <span className="font-mono tabular-nums">{fmtPct(evalMetrics.rag.refusal_accuracy, 1)}</span>
                </span>
                <span>
                  semantic <span className="font-mono tabular-nums">{evalMetrics.rag.semantic_score.toFixed(3)}</span>
                </span>
              </>
            ) : (
              <span className="text-[var(--muted)]">{evalRun.status === "running" ? "metrics pending" : "no aggregate metrics recorded"}</span>
            )}
            <span className="ml-auto text-xs text-[var(--muted)]">
              <Mono>{fmtDate(evalRun.startedAt, true)}</Mono>
            </span>
          </div>
        </>
      ) : null}

      <SectionHeader title="Latest runs" actions={<Link href="/runs" className="text-xs text-[var(--accent)] underline">All runs</Link>} />
      <Table>
        <THead>
          <Th>Run</Th>
          <Th>Type</Th>
          <Th>Status</Th>
          <Th>Step</Th>
          <Th align="right">Docs done / failed / total</Th>
          <Th align="right">Review items</Th>
          <Th align="right">Cost</Th>
          <Th>Started</Th>
        </THead>
        <tbody>
          {runs.length === 0 ? <TableEmpty colSpan={8}>No runs yet. Upload a document to start one.</TableEmpty> : null}
          {runs.map((r) => (
            <Tr key={r.id}>
              <Td>
                <Link href={`/runs/${r.id}`} className="text-[var(--accent)] underline">
                  <Mono title={r.id}>{shortId(r.id)}</Mono>
                </Link>
                {r.configJson.label ? <div className="text-xs text-[var(--muted)]">{String(r.configJson.label)}</div> : null}
              </Td>
              <Td>{r.runType}</Td>
              <Td>
                <StatusBadge status={r.status} />
              </Td>
              <Td>
                <Mono>{r.currentStep ?? ""}</Mono>
              </Td>
              <Td align="right">
                {r.documentsCompleted} / {r.documentsFailed} / {r.documentsTotal}
              </Td>
              <Td align="right">{r.reviewItemsCreated}</Td>
              <Td align="right">{fmtUsd(r.estimatedCostUsd)}</Td>
              <Td>
                <Mono>{fmtDate(r.startedAt ?? r.createdAt)}</Mono>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <SectionHeader title="Latest documents" actions={<Link href="/documents" className="text-xs text-[var(--accent)] underline">All documents</Link>} />
      <Table>
        <THead>
          <Th>Document</Th>
          <Th>Logical key</Th>
          <Th align="right">Version</Th>
          <Th>Status</Th>
          <Th align="right">Open review</Th>
          <Th>Updated</Th>
        </THead>
        <tbody>
          {docs.length === 0 ? <TableEmpty colSpan={6}>No documents yet.</TableEmpty> : null}
          {docs.map((d) => (
            <Tr key={d.id}>
              <Td>
                <Link href={`/documents/${d.id}`} className="text-[var(--accent)] underline">
                  {d.displayName}
                </Link>
                <div className="text-xs text-[var(--muted)]">{d.sourceFilename}</div>
              </Td>
              <Td>
                <Mono>{d.logicalKey}</Mono>
              </Td>
              <Td align="right">{d.versionNumber !== null ? `v${d.versionNumber}` : ""}</Td>
              <Td>
                <StatusBadge status={d.processingStatus} />
              </Td>
              <Td align="right">{d.openReviewCount}</Td>
              <Td>
                <Mono>{fmtDate(d.updatedAt)}</Mono>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function NavButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded border border-[var(--line)] bg-[var(--card)] px-2.5 py-1 text-sm hover:bg-[var(--bg)]">
      {children}
    </Link>
  );
}
