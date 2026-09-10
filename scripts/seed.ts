import "dotenv/config";
import { closeDb } from "@/lib/db/client";
import { seedWorkspace } from "@/lib/seed";
import { seedEvalCases } from "@/lib/eval/cases";

async function main() {
  const r = await seedWorkspace();
  console.log(`workspace ${r.workspaceId}; admin ${r.adminId}; reviewer ${r.reviewerId}`);
  const n = await seedEvalCases();
  console.log(`eval cases upserted: ${n}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
