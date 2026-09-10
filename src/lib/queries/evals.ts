import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import type { AggregateMetrics, RegressionReport } from "@/lib/eval/regression";

export type EvalRunRow = typeof schema.evalRuns.$inferSelect;

/** Partial view of aggregate_metrics_json: every run before completion (or a failed one) may have {}. */
export function metricsOf(run: Pick<EvalRunRow, "aggregateMetricsJson">): AggregateMetrics | null {
  const m = run.aggregateMetricsJson as Partial<AggregateMetrics> | undefined;
  return m && m.cases && m.extraction && m.review && m.rag && m.integrity && m.cost ? (m as AggregateMetrics) : null;
}

export function regressionOf(run: Pick<EvalRunRow, "regressionJson">): RegressionReport | null {
  const r = run.regressionJson as Partial<RegressionReport> | undefined;
  return r && Array.isArray(r.checks) ? (r as RegressionReport) : null;
}

export async function listEvalRuns(workspaceId: string, limit = 100) {
  return getDb().select().from(schema.evalRuns).where(eq(schema.evalRuns.workspaceId, workspaceId)).orderBy(desc(schema.evalRuns.startedAt)).limit(limit);
}

export async function getEvalRun(workspaceId: string, evalRunId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.evalRuns)
    .where(and(eq(schema.evalRuns.workspaceId, workspaceId), eq(schema.evalRuns.id, evalRunId)))
    .limit(1);
  return row ?? null;
}

export async function latestCompletedEvalRun(workspaceId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.evalRuns)
    .where(and(eq(schema.evalRuns.workspaceId, workspaceId), eq(schema.evalRuns.status, "completed")))
    .orderBy(desc(schema.evalRuns.startedAt))
    .limit(1);
  return row ?? null;
}

export async function latestEvalRun(workspaceId: string) {
  const [row] = await getDb().select().from(schema.evalRuns).where(eq(schema.evalRuns.workspaceId, workspaceId)).orderBy(desc(schema.evalRuns.startedAt)).limit(1);
  return row ?? null;
}

/** Per-case results joined with their case definitions, failing cases first. */
export async function listEvalResults(evalRunId: string) {
  return getDb()
    .select({ result: schema.evalResults, evalCase: { caseKey: schema.evalCases.caseKey, caseType: schema.evalCases.caseType, question: schema.evalCases.question, documentLogicalKey: schema.evalCases.documentLogicalKey } })
    .from(schema.evalResults)
    .innerJoin(schema.evalCases, eq(schema.evalCases.id, schema.evalResults.evalCaseId))
    .where(eq(schema.evalResults.evalRunId, evalRunId))
    .orderBy(asc(schema.evalResults.passed), asc(schema.evalCases.caseType), asc(schema.evalCases.caseKey));
}

export async function listQaReportsForRun(processingRunId: string) {
  return getDb().select().from(schema.qaReports).where(eq(schema.qaReports.processingRunId, processingRunId)).orderBy(desc(schema.qaReports.createdAt));
}

export async function listQaReportsForEvalRun(evalRunId: string) {
  return getDb().select().from(schema.qaReports).where(eq(schema.qaReports.evalRunId, evalRunId)).orderBy(desc(schema.qaReports.createdAt));
}

/** A QA report row together with its run's workspace, for access checks on the download route. */
export async function getQaReportWithWorkspace(reportId: string) {
  const [row] = await getDb()
    .select({ report: schema.qaReports, workspaceId: schema.processingRuns.workspaceId, processingRunId: schema.processingRuns.id })
    .from(schema.qaReports)
    .innerJoin(schema.processingRuns, eq(schema.processingRuns.id, schema.qaReports.processingRunId))
    .where(eq(schema.qaReports.id, reportId))
    .limit(1);
  return row ?? null;
}
