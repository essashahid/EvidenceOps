import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN, login, uploadFiles } from "./helpers";

test.describe.configure({ mode: "serial" });

test("unauthenticated users are redirected to login and can sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await login(page, ADMIN);
  await expect(page.getByText(ADMIN.email)).toBeVisible();
});

test("upload processes documents, detects duplicates and links corrected versions", async ({ page }) => {
  await login(page);
  await uploadFiles(page, ["OPS-2026-004-v1-northstar-operational-review.pdf", "AUD-2026-011-v1-meridian-water-audit-report.pdf", "AUD-2026-003-v1-orchard-valley-audit-report.pdf"]);
  await expect(page.getByText(/OPS-2026-004/).first()).toBeVisible();
  // duplicate
  await uploadFiles(page, ["copy-of-AUD-2026-011-v1-meridian-water-audit-report.pdf"]);
  await expect(page.getByText(/duplicate/i).first()).toBeVisible();
  // corrected version
  await uploadFiles(page, ["OPS-2026-004-v2-northstar-operational-review-corrected.pdf"]);
  await expect(page.getByText(/supersed/i).first()).toBeVisible();
});

test("documents list shows versions and the version page shows record, history and source", async ({ page }) => {
  await login(page);
  await page.goto("/documents");
  await page.locator("tbody tr").filter({ hasText: "OPS-2026-004" }).getByRole("link").first().click();
  await expect(page.getByText(/v2/i).first()).toBeVisible();
  await page.getByRole("link", { name: /v2|version 2/i }).first().click();
  await expect(page.getByText(/report_title|Report title/i).first()).toBeVisible();
  await expect(page.locator('[id^="SRC-OPS-2026-004-V2-P"]').first()).toBeAttached();
});

test("runs page shows steps, events and cost for the ingest run", async ({ page }) => {
  await login(page);
  await page.goto("/runs");
  // pick a run that processed at least one document (the duplicate-upload run has 0 / 0 / 0)
  const row = page.locator("tbody tr").filter({ hasText: /\d+ \/ \d+ \/ [1-9]\d*/ }).first();
  await row.locator('a[href^="/runs/"]').first().click();
  await expect(page.getByText(/route_review/).first()).toBeVisible();
  await expect(page.getByText(/step\.succeeded|succeeded/i).first()).toBeVisible();
});

test("review queue lists planted uncertain fields and edit & accept creates a new record version", async ({ page }) => {
  await login(page, { email: "reviewer@evidenceops.local", password: "evidenceops-reviewer" });
  await page.goto("/review");
  const first = page.locator("tbody tr").filter({ hasText: "AUD-2026-003" }).filter({ hasText: /monetary/i }).locator('a[href^="/review/"]').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByText(/confidence/i).first()).toBeVisible();
  // planted items either highlight the exact quote or state that the quote was not found verbatim
  await expect(page.locator("mark").first().or(page.getByText(/not found verbatim/i).first())).toBeVisible();
  const editor = page.locator('[name="newValue"]');
  const candidate = JSON.parse(await editor.inputValue());
  await editor.fill(JSON.stringify({ ...candidate, amount: 512000 }));
  await page.locator('[name="comment"]').fill("The reconciliation paragraph revises the amount to USD 512,000.");
  await page.getByRole("button", { name: "Edit & Accept", exact: true }).click();
  await expect(page).toHaveURL(/\/review/);
});

test("ask answers with citations and refuses unanswerable questions", async ({ page }) => {
  await login(page);
  await page.goto("/ask");
  await page.getByRole("textbox").first().fill("What is the total Dock Optimization Program cost to date according to the current Northstar operational review?");
  await page.getByRole("button", { name: /ask|submit|answer/i }).first().click();
  await expect(page.getByText(/\$|million|cost/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("a[href*='#SRC-']").first()).toBeVisible();
  await page.goto("/ask");
  await page.getByRole("textbox").first().fill("What dividend did Zephyr Holdings declare in 2019?");
  await page.getByRole("button", { name: /ask|submit|answer/i }).first().click();
  await expect(page.getByText(/cannot answer|refus|insufficient/i).first()).toBeVisible({ timeout: 60_000 });
});

test("evals page runs the suite and links the QA report", async ({ page }) => {
  test.setTimeout(600_000);
  await login(page);
  // the golden suite fails loudly unless every manifest fixture is ingested; upload the full corpus first
  const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "fixtures/documents/manifest.json"), "utf8")) as { files: { filename: string }[] };
  await uploadFiles(page, manifest.files.map((f) => f.filename));
  await page.goto("/evals");
  await page.getByRole("button", { name: /run evaluation/i }).click();
  await expect(page).toHaveURL(/\/evals\/[0-9a-f-]+/, { timeout: 540_000 });
  await expect(page.getByText(/regression/i).first()).toBeVisible();
});
