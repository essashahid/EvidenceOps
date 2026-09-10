import { expect, it } from "vitest";
import { getDb, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { seeded } from "./helpers";
import { seedEvalCases } from "@/lib/eval/cases";
import { ingestCorpus } from "@/lib/eval/corpus";
import { createEvaluationRun, runEvaluation } from "@/lib/eval/run";

it("replays every evaluation checkpoint without repeating model calls or result rows", async () => {
  const seed = await seeded();
  await seedEvalCases();
  const corpus = await ingestCorpus({ workspaceId: seed.workspaceId, userId: seed.adminId });
  const run = await createEvaluationRun({ workspaceId: seed.workspaceId, processingRunId: corpus.processingRunId });
  const checkpoints = new Map<string, unknown>();
  const checkpoint = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if (checkpoints.has(name)) return structuredClone(checkpoints.get(name)) as T;
    const result = await fn();
    checkpoints.set(name, JSON.parse(JSON.stringify(result)));
    return result;
  };
  const options = { workspaceId: seed.workspaceId, userId: seed.adminId, evalRunId: run.id, processingRunId: corpus.processingRunId, skipResumability: true, checkpoint };
  const first = await runEvaluation(options);
  const calls = await getDb().select().from(schema.llmCalls);
  const second = await runEvaluation(options);
  expect(second.metrics).toEqual(first.metrics);
  expect(second.results).toEqual(first.results);
  expect(await getDb().select().from(schema.llmCalls)).toHaveLength(calls.length);
  expect(await getDb().select().from(schema.evalResults).where(eq(schema.evalResults.evalRunId, run.id))).toHaveLength(first.results.length);
  expect(first.results.length).toBe(146);
  const [stored] = await getDb().select().from(schema.evalRuns).where(eq(schema.evalRuns.id, run.id));
  expect(stored!.isBaseline).toBe(false); // skipped integrity checks cannot establish a baseline
  const [record] = await getDb().select().from(schema.recordVersions).where(eq(schema.recordVersions.createdByType, "model")).limit(1);
  await getDb().update(schema.recordVersions).set({ modelConfigHash: "different-provider" }).where(eq(schema.recordVersions.id, record!.id));
  await expect(runEvaluation(options)).rejects.toThrow("Reprocess the corpus");
}, 180_000);
