import "dotenv/config";
import { getSql, closeDb } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { databaseUrl } from "@/lib/env";

async function main() {
  console.log(`migrating ${databaseUrl()}`);
  await migrate(getSql(), { log: console.log });
  await closeDb();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
