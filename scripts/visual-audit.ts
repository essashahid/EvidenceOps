import "./load-env";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";
import { getSql, closeDb } from "@/lib/db/client";

async function main() {
  const baseURL = process.env.VISUAL_AUDIT_URL ?? "http://localhost:3000";
  const sql = getSql();
  const [ws] = await sql`select id from workspaces where slug='default'`;
  const [version] = await sql`select dv.id, dv.document_id from document_versions dv join documents d on d.id=dv.document_id where dv.workspace_id=${ws!.id} and d.logical_key='AUD-2026-003' order by dv.version_number desc limit 1`;
  const [review] = await sql`select id from review_items where workspace_id=${ws!.id} and status='open' order by case when priority='high' then 0 else 1 end, created_at limit 1`;
  const [evaluation] = await sql`select id, processing_run_id from eval_runs where workspace_id=${ws!.id} and status='completed' order by completed_at desc limit 1`;
  const [answer] = await sql`select a.id from rag_answers a join rag_queries q on q.id=a.rag_query_id where q.workspace_id=${ws!.id} and a.sufficient_evidence order by a.created_at desc limit 1`;
  const [report] = await sql`select id from qa_reports where eval_run_id=${evaluation!.id} and status='generated' order by created_at desc limit 1`;
  const routes: [string,string][] = [
    ['dashboard','/'], ['documents','/documents'],
    ['provenance',`/documents/${version!.document_id}/versions/${version!.id}`],
    ['review',`/review/${review!.id}`], ['answer',`/ask?answer=${answer!.id}`],
    ['evaluations',`/evals/${evaluation!.id}`], ['run',`/runs/${evaluation!.processing_run_id}`],
    ['qa-report',`/reports/${report!.id}`],
  ];
  await fs.mkdir('docs/screenshots',{recursive:true});
  const browser = await chromium.launch();
  try {
  const page = await browser.newPage({ viewport:{width:1440,height:1000} });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const results = [];
  for (const [name, route] of routes) {
    const response = await page.goto(`${baseURL}${route}`,{waitUntil:'domcontentloaded'});
    await page.screenshot({path:`docs/screenshots/${name}.png`,fullPage:name==='review'});
    const state = await page.evaluate(() => ({ title:document.querySelector('h1')?.textContent, overflow:document.documentElement.scrollWidth>window.innerWidth+1, text:document.body.innerText.length, overlay:Boolean(document.querySelector('nextjs-portal')) }));
    results.push({name,status:response?.status(),...state});
  }
  for (const route of ['/','/documents','/review','/ask','/evals','/runs','/upload']) {
    await page.setViewportSize({width:390,height:844});
    const response=await page.goto(`${baseURL}${route}`,{waitUntil:'domcontentloaded'});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    results.push({name:`mobile:${route}`,status:response?.status(),overflow});
    if(route==='/' || route==='/documents') await page.screenshot({path:`docs/screenshots/mobile-${route==='/'?'dashboard':'documents'}.png`,fullPage:true});
  }
  await page.goto(`${baseURL}/upload`);
  const publicUploadDisabled=await page.locator('input[type=file]').isDisabled();
  await page.goto(`${baseURL}/ask`);
  const publicAskDisabled=await page.getByRole('button',{name:/Ask|Answer/,exact:false}).isDisabled();
  const passed=results.every(r=>r.status===200&&!r.overflow)&&errors.length===0&&publicUploadDisabled&&publicAskDisabled;
  if(!passed) process.exitCode=1;
  await fs.writeFile('.data/visual-audit.json',JSON.stringify({passed,results,errors,publicUploadDisabled,publicAskDisabled},null,2));
  console.log(JSON.stringify({passed,results,errors,publicUploadDisabled,publicAskDisabled},null,2));
  } finally { await browser.close(); await closeDb(); }

}
main().catch(async error=>{console.error(error);await closeDb();process.exitCode=1;});
