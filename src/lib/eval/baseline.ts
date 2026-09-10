import fs from "node:fs";
import path from "node:path";
import type { AggregateMetrics } from "./regression";

export const BASELINE_DIR = path.resolve(process.cwd(), "eval/baselines");

export type BaselineFile = { provider: string; corpusVersion?: string; modelConfigHash: string; evalRunId: string | null; recordedAt: string; metrics: AggregateMetrics };

export function baselinePath(provider: string): string {
  return path.join(BASELINE_DIR, `${provider}.json`);
}

export function readBaselineFile(provider: string): BaselineFile | null {
  const p = baselinePath(provider);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as BaselineFile;
}

export function writeBaselineFile(file: BaselineFile) {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.writeFileSync(baselinePath(file.provider), `${JSON.stringify(file, null, 2)}\n`);
}
