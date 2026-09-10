import "dotenv/config";
import { getSql, closeDb } from "@/lib/db/client";
import { resetDatabase } from "@/lib/db/migrate";
import { databaseUrl } from "@/lib/env";

async function main() {
  const url = databaseUrl();
  if (process.env.NODE_ENV === "production") throw new Error("refusing to reset a production database");
  console.log(`resetting ${url}`);
  await resetDatabase(getSql());
  await closeDb();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
