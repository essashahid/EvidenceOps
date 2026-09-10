import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const ADMIN = { email: "admin@evidenceops.local", password: "evidenceops-admin" };
export const REVIEWER = { email: "reviewer@evidenceops.local", password: "evidenceops-reviewer" };

export async function login(page: Page, user = ADMIN) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export function corpusFile(name: string) {
  return path.resolve(process.cwd(), "fixtures/documents", name);
}

export async function uploadFiles(page: Page, files: string[]) {
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles(files.map(corpusFile));
  await page.getByRole("button", { name: /upload/i }).click();
  await expect(page.getByText("Results", { exact: true }).first()).toBeVisible({ timeout: 300_000 });
}
