import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  deleteChunksForFile,
  getSettings,
  insertChunk,
  insertChunkEmbedding,
  updateFileRecord,
} from "../db/queries";
import { ensureVecTable } from "../db/schema";
import { projectFilesDir } from "../db/paths";
import { embedTexts } from "../lmstudio/client";
import { chunkFileContent } from "./chunker";
import type { ProjectFile } from "../db/types";

export async function indexFile(file: ProjectFile): Promise<ProjectFile> {
  deleteChunksForFile(file.id);

  const filePath = join(projectFilesDir(file.project_id), file.relative_path);
  const content = await readFile(filePath, "utf8");
  const chunks = chunkFileContent(file.filename, content);

  const chunkIds: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const chunkId = insertChunk(
      file.id,
      index,
      chunk.content,
      chunk.startLine,
      chunk.endLine,
      file.filename,
    );
    chunkIds.push(chunkId);
  }

  const settings = getSettings();
  let indexStatus: ProjectFile["index_status"] = "fts_only";
  let errorMessage: string | null = null;
  let embeddingModel: string | null = null;

  if (settings.embedding_model && chunkIds.length > 0) {
    try {
      const embeddings = await embedTexts(chunks.map((c) => c.content));
      const dimensions = embeddings[0]?.length ?? settings.embedding_dimensions;

      // Idempotent: only rebuilds when the dimension actually changes, and never
      // wipes other files' vectors (see ensureVecTable in schema.ts).
      ensureVecTable(dimensions);

      for (let i = 0; i < chunkIds.length; i++) {
        const embedding = embeddings[i];
        if (embedding) {
          insertChunkEmbedding(chunkIds[i]!, embedding);
        }
      }
      indexStatus = "indexed";
      embeddingModel = settings.embedding_model;
    } catch (error) {
      indexStatus = "fts_only";
      errorMessage =
        error instanceof Error ? error.message : "Embedding failed";
    }
  } else if (chunks.length > 0) {
    indexStatus = "fts_only";
  }

  const indexedAt = new Date().toISOString();
  updateFileRecord(file.id, {
    chunk_count: chunks.length,
    indexed_at: indexedAt,
    index_status: indexStatus,
    error_message: errorMessage,
    embedding_model: embeddingModel,
  });

  return {
    ...file,
    chunk_count: chunks.length,
    indexed_at: indexedAt,
    index_status: indexStatus,
    error_message: errorMessage,
    embedding_model: embeddingModel,
  };
}

/**
 * Mark a file as indexing and run indexFile in the background (fire-and-forget)
 * so uploads return immediately. Failures are captured onto the file record.
 */
export function queueIndexing(file: ProjectFile): void {
  updateFileRecord(file.id, {
    index_status: "indexing",
    error_message: null,
  });

  void indexFile({ ...file, index_status: "indexing" }).catch((error) => {
    const message =
      error instanceof Error ? error.message : "Indexing failed";
    updateFileRecord(file.id, {
      index_status: "error",
      error_message: message,
    });
  });
}
