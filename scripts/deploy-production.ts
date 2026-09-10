import fs from "node:fs";
import dotenv from "dotenv";
import { spawnSync } from "node:child_process";

/** Complete the authorized deployment once .data/production.env has the missing credentials. */
function main() {
  const file = process.env.PRODUCTION_ENV_FILE ?? ".data/production.env";
  if (!fs.existsSync(file)) throw new Error(`Create ${file} from .env.example and fill the production credentials.`);
  const config = dotenv.parse(fs.readFileSync(file));
  const required = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY", "DEMO_ADMIN_PASSWORD", "DEMO_REVIEWER_PASSWORD", "DEMO_VIEWER_PASSWORD"];
  const missing = required.filter(key => !config[key]);
  if (missing.length) throw new Error(`Fill ${missing.join(", ")} in ${file}. No deployment changes made.`);
  const database = new URL(config.DATABASE_URL!);
  if (["localhost", "127.0.0.1", "::1"].includes(database.hostname) || database.port === "6543") throw new Error("Production needs the hosted Supabase direct connection or session pooler on port 5432.");
  if (config.AUTH_DRIVER !== "supabase" || config.STORAGE_DRIVER !== "supabase" || config.JOB_DRIVER !== "inngest") throw new Error("Production drivers must be supabase/supabase/inngest.");
  for (const key of required.filter(key => key.endsWith("PASSWORD"))) if (config[key]!.length < 16) throw new Error(`${key} must have at least 16 characters.`);
  function run(command: string, args: string[], overrides: Record<string, string> = {}) {
    const result = spawnSync(command, args, { stdio: "inherit", env: { ...process.env, ...config, ...overrides } });
    if (result.status !== 0) throw new Error(`${command} ${args[0]} failed; deployment stopped.`);
  }
  run("pnpm", ["db:migrate"]);
  // The seed is processed once from this workstation. Deployed jobs use Inngest.
  run("pnpm", ["seed:demo"], { JOB_DRIVER: "inline" });
  for (const [key, value] of Object.entries(config)) {
    if (!value) continue;
    for (const environment of ["production", "preview"]) {
      const result = spawnSync("vercel", ["env", "add", key, environment, "--force"], { input: value, encoding: "utf8" });
      if (result.status !== 0) throw new Error(`Could not configure ${key} for ${environment}.`);
    }
    console.log(`Configured ${key}`);
  }
  run("vercel", ["deploy", "--prod", "--yes"]);
  console.log("Verify the deployed /api/inngest app is synced in Inngest, then exercise a hosted upload and retry.");
}
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
