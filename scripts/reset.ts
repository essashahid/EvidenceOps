import "./load-env";
import { getSql, closeDb } from "@/lib/db/client";
import { resetDatabase } from "@/lib/db/migrate";
import { databaseUrl } from "@/lib/env";

async function main() {
  const url = databaseUrl();
  if (process.env.NODE_ENV === "production") throw new Error("refusing to reset a production database");
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname)) throw new Error("Reset is restricted to local databases");
  console.log(`resetting ${new URL(url).pathname}`);
  await resetDatabase(getSql());
  await closeDb();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
