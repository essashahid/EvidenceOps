import "dotenv/config";
import { closeDb } from "@/lib/db/client";
import { seedWorkspace } from "@/lib/seed";
import { ingestCorpus } from "@/lib/eval/corpus";

async function main() {
  const seed = await seedWorkspace();
  const result = await ingestCorpus({ workspaceId: seed.workspaceId, userId: seed.adminId, wait: !process.argv.includes("--no-wait"), log: console.log });
  console.log(`created ${result.created}, duplicates ${result.duplicates}, run ${result.processingRunId ?? "none"}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
