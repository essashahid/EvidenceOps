import { requireWorkspace } from "@/lib/workspace";
import { loadQaReportHtml } from "@/lib/report/qa-report";
import { getQaReportWithWorkspace } from "@/lib/queries/evals";

export const dynamic = "force-dynamic";

/** Serve a generated QA report (HTML). `?download=1` sends it as an attachment. */
export async function GET(request: Request, ctx: RouteContext<"/reports/[reportId]">) {
  const { reportId } = await ctx.params;
  const { workspace } = await requireWorkspace();
  const row = await getQaReportWithWorkspace(reportId);
  if (!row || row.workspaceId !== workspace.workspaceId) return new Response("Report not found", { status: 404 });
  if (row.report.status !== "generated") return new Response(`Report is ${row.report.status}${row.report.errorMessage ? `: ${row.report.errorMessage}` : ""}`, { status: 409 });
  const html = await loadQaReportHtml(reportId);
  if (html === null) return new Response("Report file is missing from storage", { status: 404 });
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" });
  if (new URL(request.url).searchParams.get("download") === "1") {
    headers.set("content-disposition", `attachment; filename="evidenceops_run_${row.processingRunId}_qa.html"`);
  }
  return new Response(html, { status: 200, headers });
}
