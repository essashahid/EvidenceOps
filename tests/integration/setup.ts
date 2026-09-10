import { beforeAll, afterAll } from "vitest";
import dotenv from "dotenv";

process.env.EVIDENCEOPS_DB = "test";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.LLM_PROVIDER = "mock";
process.env.JOB_DRIVER = "inline";
process.env.STORAGE_DRIVER = "local";
process.env.AUTH_DRIVER = "local";
dotenv.config({ override: false });

beforeAll(async () => {
  const { getSql } = await import("@/lib/db/client");
  const { resetDatabase } = await import("@/lib/db/migrate");
  await resetDatabase(getSql());
});

afterAll(async () => {
  const { closeDb } = await import("@/lib/db/client");
  await closeDb();
});
