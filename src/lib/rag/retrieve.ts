import { getSql } from "@/lib/db/client";
import { getLlm } from "@/lib/llm";
import { RETRIEVAL } from "@/lib/config";

export type RetrievedChunk = {
  chunkId: string;
  documentVersionId: string;
  documentId: string;
  displayName: string;
  logicalKey: string;
  versionNumber: number;
  isCurrent: boolean;
  chunkIndex: number;
  text: string;
  startLocator: string;
  endLocator: string;
  similarity: number;
  lexical: number;
  combined: number;
};

export type RetrieveInput = { workspaceId: string; query: string; includeSuperseded?: boolean; topK?: number };

type Row = {
  chunk_id: string;
  document_version_id: string;
  document_id: string;
  display_name: string;
  logical_key: string;
  version_number: number;
  is_current: boolean;
  chunk_index: number;
  text: string;
  start_locator: string;
  end_locator: string;
  similarity: number | null;
  lexical: number | null;
};

/**
 * Hybrid retrieval: 75% cosine similarity (pgvector) + 25% PostgreSQL full-text rank,
 * each normalized to 0..1 over the candidate pool. Only current document versions are eligible
 * unless `includeSuperseded` is set. Returns the top K (default 8).
 */
export async function retrieve(input: RetrieveInput): Promise<{ queryEmbedding: number[]; results: RetrievedChunk[]; usage: { inputTokens: number; model: string } }> {
  const llm = getLlm();
  const sql = getSql();
  const topK = input.topK ?? RETRIEVAL.topK;
  const pool = topK * RETRIEVAL.candidateMultiplier;
  const emb = await llm.embed([input.query]);
  const queryEmbedding = emb.vectors[0] ?? [];
  const vec = `[${queryEmbedding.join(",")}]`;
  const currentOnly = !input.includeSuperseded;

  const rows = await sql<Row[]>`
    with vec as (
      select c.id as chunk_id, 1 - (c.embedding <=> ${vec}::vector) as similarity
      from chunks c
      join document_versions dv on dv.id = c.document_version_id
      where c.workspace_id = ${input.workspaceId} and c.embedding is not null
        and (${currentOnly}::boolean = false or dv.is_current)
      order by c.embedding <=> ${vec}::vector
      limit ${pool}
    ),
    lex as (
      select c.id as chunk_id, ts_rank_cd(c.search_tsv, websearch_to_tsquery('english', ${input.query})) as rank
      from chunks c
      join document_versions dv on dv.id = c.document_version_id
      where c.workspace_id = ${input.workspaceId}
        and c.search_tsv @@ websearch_to_tsquery('english', ${input.query})
        and (${currentOnly}::boolean = false or dv.is_current)
      order by rank desc
      limit ${pool}
    ),
    cand as (
      select chunk_id from vec union select chunk_id from lex
    )
    select c.id as chunk_id, c.document_version_id, dv.document_id, d.display_name, d.logical_key, dv.version_number, dv.is_current,
           c.chunk_index, c.text, c.start_locator, c.end_locator,
           vec.similarity, lex.rank as lexical
    from cand
    join chunks c on c.id = cand.chunk_id
    join document_versions dv on dv.id = c.document_version_id
    join documents d on d.id = dv.document_id
    left join vec on vec.chunk_id = c.id
    left join lex on lex.chunk_id = c.id
  `;

  const maxLex = Math.max(0, ...rows.map((r) => Number(r.lexical ?? 0)));
  const sims = rows.map((r) => Number(r.similarity ?? 0));
  const minSim = Math.min(0, ...sims);
  const maxSim = Math.max(minSim + 1e-9, ...sims);
  const results: RetrievedChunk[] = rows
    .map((r) => {
      const rawSim = Number(r.similarity ?? 0);
      const similarity = Math.max(0, Math.min(1, rawSim));
      const simNorm = (rawSim - minSim) / (maxSim - minSim);
      const lexical = maxLex > 0 ? Number(r.lexical ?? 0) / maxLex : 0;
      const combined = RETRIEVAL.vectorWeight * simNorm + RETRIEVAL.lexicalWeight * lexical;
      return {
        chunkId: r.chunk_id,
        documentVersionId: r.document_version_id,
        documentId: r.document_id,
        displayName: r.display_name,
        logicalKey: r.logical_key,
        versionNumber: Number(r.version_number),
        isCurrent: Boolean(r.is_current),
        chunkIndex: Number(r.chunk_index),
        text: r.text,
        startLocator: r.start_locator,
        endLocator: r.end_locator,
        similarity: round(similarity),
        lexical: round(lexical),
        combined: round(combined),
      };
    })
    .sort((a, b) => b.combined - a.combined)
    .slice(0, topK);
  return { queryEmbedding, results, usage: { inputTokens: emb.usage.inputTokens, model: emb.usage.model } };
}

function round(n: number): number {
  return Math.round(n * 100000) / 100000;
}
