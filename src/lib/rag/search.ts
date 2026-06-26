import {
  ftsSearch,
  getChunkEmbeddings,
  getSettings,
  reciprocalRankFusion,
  vectorSearch,
} from "../db/queries";
import { embedQuery } from "../lmstudio/client";
import type { SearchResult } from "../db/types";

/**
 * Hybrid retrieval: fetch a candidate pool via FTS (+ vector search when an
 * embedding model is configured), fuse with RRF, drop near-duplicate chunks,
 * then apply MMR for diversity before trimming to `limit`.
 */
export async function hybridSearch(
  projectId: string,
  query: string,
  limit = 8,
): Promise<SearchResult[]> {
  const settings = getSettings();
  const poolSize = Math.max(settings.retrieval_candidate_pool, limit);

  const ftsResults = ftsSearch(projectId, query, poolSize);

  if (!settings.embedding_model) {
    return dedupeOverlapping(ftsResults).slice(0, limit);
  }

  try {
    const embedding = await embedQuery(query);
    if (!embedding) return dedupeOverlapping(ftsResults).slice(0, limit);

    const vectorResults = vectorSearch(projectId, embedding, poolSize);
    if (vectorResults.length === 0) {
      return dedupeOverlapping(ftsResults).slice(0, limit);
    }

    const fused = reciprocalRankFusion([vectorResults, ftsResults]);
    const deduped = dedupeOverlapping(fused);
    return mmrRerank(deduped, embedding, limit);
  } catch {
    return dedupeOverlapping(ftsResults).slice(0, limit);
  }
}

/**
 * Remove near-duplicate chunks from the same file whose line ranges overlap or
 * are adjacent, keeping the higher-ranked occurrence.
 */
function dedupeOverlapping(results: SearchResult[]): SearchResult[] {
  const kept: SearchResult[] = [];
  for (const candidate of results) {
    const overlaps = kept.some(
      (k) =>
        k.file_id === candidate.file_id &&
        rangesOverlap(
          k.start_line,
          k.end_line,
          candidate.start_line,
          candidate.end_line,
        ),
    );
    if (!overlaps) kept.push(candidate);
  }
  return kept;
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  // Treat adjacent ranges (touching within 1 line) as overlapping.
  return aStart <= bEnd + 1 && bStart <= aEnd + 1;
}

/**
 * Maximal Marginal Relevance: balance relevance to the query against diversity
 * among selected chunks, using persisted chunk embeddings. Falls back to rank
 * order for chunks without an embedding.
 */
function mmrRerank(
  candidates: SearchResult[],
  queryEmbedding: Float32Array,
  limit: number,
  lambda = 0.7,
): SearchResult[] {
  if (candidates.length <= limit) return candidates;

  const embeddings = getChunkEmbeddings(candidates.map((c) => c.chunk_id));
  // If we have no embeddings for the candidates, MMR cannot help; keep order.
  if (embeddings.size === 0) return candidates.slice(0, limit);

  const relevance = new Map<string, number>();
  for (const candidate of candidates) {
    const emb = embeddings.get(candidate.chunk_id);
    relevance.set(
      candidate.chunk_id,
      emb ? cosineSimilarity(queryEmbedding, emb) : 0,
    );
  }

  const selected: SearchResult[] = [];
  const remaining = [...candidates];

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const rel = relevance.get(candidate.chunk_id) ?? 0;
      const emb = embeddings.get(candidate.chunk_id);

      let maxSim = 0;
      if (emb) {
        for (const chosen of selected) {
          const chosenEmb = embeddings.get(chosen.chunk_id);
          if (chosenEmb) {
            maxSim = Math.max(maxSim, cosineSimilarity(emb, chosenEmb));
          }
        }
      }

      const mmrScore = lambda * rel - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = i;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return selected;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No matching documents found.";

  return results
    .map(
      (result, index) =>
        `[${index + 1}] ${result.filename} (lines ${result.start_line}-${result.end_line})\n${result.content}`,
    )
    .join("\n\n---\n\n");
}
