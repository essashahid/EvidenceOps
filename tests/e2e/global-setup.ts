import { execFileSync } from "node:child_process";

/** Reset and seed the TEST database before the e2e run (runs the project scripts in a child process). */
export default async function globalSetup() {
  const env = { ...process.env, EVIDENCEOPS_DB: "test", LLM_PROVIDER: "mock", JOB_DRIVER: "inline", STORAGE_DRIVER: "local", AUTH_DRIVER: "local" };
  execFileSync("pnpm", ["exec", "tsx", "scripts/reset.ts"], { env, stdio: "inherit" });
  execFileSync("pnpm", ["exec", "tsx", "scripts/seed.ts"], { env, stdio: "inherit" });
}
