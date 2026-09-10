import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { getDashboardStats, listRecentRuns } from "@/lib/queries/dashboard";
import { listDocuments } from "@/lib/queries/documents";
import { latestEvalRun, metricsOf, regressionOf } from "@/lib/queries/evals";
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
  const runsHint = Object.entries(stats.runsByStatus)
    .sort()
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={workspace.name}
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
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Documents" value={fmtNumber(stats.documents)} hint="current versions" />
        <StatCard label="Versions" value={fmtNumber(stats.versions)} hint="all uploads" />
        <StatCard label="Open review" value={fmtNumber(stats.openReviewItems)} tone={stats.openReviewItems > 0 ? "warn" : undefined} hint={<Link href="/review" className="underline">review queue</Link>} />
        <StatCard label="Runs" value={fmtNumber(stats.runsTotal)} hint={runsHint || "none yet"} />
        <StatCard label="Dead letters" value={fmtNumber(stats.deadLettersOpen)} tone={stats.deadLettersOpen > 0 ? "bad" : undefined} hint="open or retrying" />
        <StatCard label="Est. cost" value={fmtUsd(stats.costUsd)} hint="sum of run estimates" />
        <StatCard label="Tokens in / out" value={`${fmtNumber(stats.inputTokens)} / ${fmtNumber(stats.outputTokens)}`} hint="LLM prompt / completion" />
        <StatCard label="Embedding tokens" value={fmtNumber(stats.embeddingTokens)} />
      </div>

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
                  evidence <span className="font-mono tabular-nums">{fmtPct(evalMetrics.extraction.evidence_validity, 1)}</span>
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
