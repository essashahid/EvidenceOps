import { cn } from "@/lib/utils";

export const PIPELINE_STAGES: { title: string; body: string }[] = [
  { title: "Hash and version", body: "The file is hashed. An identical hash is a duplicate; a new hash for the same logical key becomes the next version." },
  { title: "Parse and chunk", body: "PDF pages or DOCX paragraphs become addressable source blocks, then overlapping chunks." },
  { title: "Extract with evidence", body: "Every value the model returns must cite a source block and quote it verbatim." },
  { title: "Validate and verify", body: "Deterministic checks run in code, then a second model verifies each value without seeing the first one's confidence." },
  { title: "Score and route", body: "Code computes confidence from five components and routes each value to auto-approval, review or blocked." },
  { title: "Embed and index", body: "Chunks are embedded for hybrid retrieval so the document can be asked about." },
];

/** What happens to a document after it is uploaded, in the order it happens. */
export function PipelineExplainer({ columns = 3, className = "" }: { columns?: 2 | 3; className?: string }) {
  return (
    <ol className={cn("grid gap-2.5 text-[13px] leading-5 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3", className)}>
      {PIPELINE_STAGES.map((s, i) => (
        <li key={s.title} className="flex gap-2.5">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent)]">{i + 1}</span>
          <span>
            <span className="font-medium">{s.title}.</span> <span className="text-[var(--muted)]">{s.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
