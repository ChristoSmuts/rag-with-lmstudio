import { nanoid } from "nanoid";
import { getDb } from "./schema";
import type {
  AppSettings,
  Chat,
  Memory,
  Message,
  Project,
  ProjectFile,
  SearchResult,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { normalizeLmStudioBaseUrl } from "../lmstudio/url";

function nowIso(): string {
  return new Date().toISOString();
}

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings")
    .all() as Array<{ key: string; value: string }>;

  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    const key = row.key as keyof AppSettings;
    if (key in settings) {
      settings[key] = JSON.parse(row.value) as never;
    }
  }
  settings.lmstudio_base_url = normalizeLmStudioBaseUrl(settings.lmstudio_base_url);
  return settings;
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const db = getDb();
  const current = getSettings();
  const next = { ...current, ...partial };
  if (partial.lmstudio_base_url !== undefined) {
    next.lmstudio_base_url = normalizeLmStudioBaseUrl(partial.lmstudio_base_url);
  }
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(next)) {
    stmt.run(key, JSON.stringify(value));
  }
  return next;
}

export function listProjects(): Project[] {
  return getDb()
    .prepare(
      "SELECT id, name, description, created_at FROM projects ORDER BY created_at DESC",
    )
    .all() as Project[];
}

export function getProject(id: string): Project | null {
  return (
    (getDb()
      .prepare(
        "SELECT id, name, description, created_at FROM projects WHERE id = ?",
      )
      .get(id) as Project | null) ?? null
  );
}

export function createProject(name: string, description = ""): Project {
  const project: Project = {
    id: nanoid(),
    name,
    description,
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      "INSERT INTO projects (id, name, description, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(project.id, project.name, project.description, project.created_at);
  return project;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "description">>,
): Project | null {
  const existing = getProject(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  getDb()
    .prepare("UPDATE projects SET name = ?, description = ? WHERE id = ?")
    .run(next.name, next.description, id);
  return next;
}

export function deleteProject(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM projects WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

export function listFiles(projectId: string): ProjectFile[] {
  return getDb()
    .prepare(
      `SELECT id, project_id, filename, relative_path, mime, size, indexed_at,
              chunk_count, index_status, error_message, embedding_model,
              original_relative_path, source_mime
       FROM files WHERE project_id = ? ORDER BY filename ASC`,
    )
    .all(projectId) as ProjectFile[];
}

export function getFile(fileId: string): ProjectFile | null {
  return (
    (getDb()
      .prepare(
        `SELECT id, project_id, filename, relative_path, mime, size, indexed_at,
                chunk_count, index_status, error_message, embedding_model,
                original_relative_path, source_mime
         FROM files WHERE id = ?`,
      )
      .get(fileId) as ProjectFile | null) ?? null
  );
}

/**
 * Files that would benefit from (re)indexing with embeddings: either keyword-only
 * while an embedding model is configured, or indexed with a different model.
 */
export function listStaleFiles(
  projectId: string,
  embeddingModel: string,
): ProjectFile[] {
  if (!embeddingModel) return [];
  return listFiles(projectId).filter((file) => {
    if (file.index_status === "fts_only") return true;
    if (
      file.index_status === "indexed" &&
      file.embedding_model !== embeddingModel
    ) {
      return true;
    }
    return false;
  });
}

export function createFileRecord(
  projectId: string,
  filename: string,
  relativePath: string,
  mime: string,
  size: number,
  options?: {
    original_relative_path?: string | null;
    source_mime?: string | null;
  },
): ProjectFile {
  const file: ProjectFile = {
    id: nanoid(),
    project_id: projectId,
    filename,
    relative_path: relativePath,
    mime,
    size,
    indexed_at: null,
    chunk_count: 0,
    index_status: "pending",
    error_message: null,
    embedding_model: null,
    original_relative_path: options?.original_relative_path ?? null,
    source_mime: options?.source_mime ?? null,
  };
  getDb()
    .prepare(
      `INSERT INTO files (id, project_id, filename, relative_path, mime, size, index_status,
        original_relative_path, source_mime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      file.id,
      file.project_id,
      file.filename,
      file.relative_path,
      file.mime,
      file.size,
      file.index_status,
      file.original_relative_path,
      file.source_mime,
    );
  return file;
}

export function updateFileRecord(
  fileId: string,
  patch: Partial<
    Pick<
      ProjectFile,
      | "relative_path"
      | "mime"
      | "size"
      | "chunk_count"
      | "indexed_at"
      | "index_status"
      | "error_message"
      | "embedding_model"
    >
  >,
): void {
  const file = getFile(fileId);
  if (!file) return;
  const next = { ...file, ...patch };
  getDb()
    .prepare(
      `UPDATE files SET relative_path = ?, mime = ?, size = ?, chunk_count = ?, indexed_at = ?,
              index_status = ?, error_message = ?, embedding_model = ?
       WHERE id = ?`,
    )
    .run(
      next.relative_path,
      next.mime,
      next.size,
      next.chunk_count,
      next.indexed_at,
      next.index_status,
      next.error_message,
      next.embedding_model,
      fileId,
    );
}

export function deleteFileRecord(fileId: string): ProjectFile | null {
  const file = getFile(fileId);
  if (!file) return null;
  getDb().prepare("DELETE FROM files WHERE id = ?").run(fileId);
  return file;
}

export function deleteChunksForFile(fileId: string): void {
  const db = getDb();
  const chunkIds = db
    .prepare("SELECT id FROM file_chunks WHERE file_id = ?")
    .all(fileId) as Array<{ id: string }>;

  for (const { id } of chunkIds) {
    db.prepare("DELETE FROM file_chunks_fts WHERE chunk_id = ?").run(id);
    try {
      db.prepare("DELETE FROM chunk_vectors WHERE chunk_id = ?").run(id);
    } catch {
      // vec table may not exist
    }
  }

  db.prepare("DELETE FROM file_chunks WHERE file_id = ?").run(fileId);
}

export function insertChunk(
  fileId: string,
  chunkIndex: number,
  content: string,
  startLine: number,
  endLine: number,
  filename: string,
): string {
  const id = nanoid();
  const db = getDb();
  db.prepare(
    `INSERT INTO file_chunks (id, file_id, chunk_index, content, start_line, end_line)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, fileId, chunkIndex, content, startLine, endLine);
  db.prepare(
    "INSERT INTO file_chunks_fts (chunk_id, file_id, filename, content) VALUES (?, ?, ?, ?)",
  ).run(id, fileId, filename, content);
  return id;
}

export function insertChunkEmbedding(
  chunkId: string,
  embedding: Float32Array,
): void {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)",
  ).run(chunkId, Buffer.from(embedding.buffer));

  try {
    db.prepare(
      "INSERT OR REPLACE INTO chunk_vectors (chunk_id, embedding) VALUES (?, ?)",
    ).run(chunkId, Buffer.from(embedding.buffer));
  } catch {
    // vec table optional
  }
}

export function listChats(projectId: string): Chat[] {
  return getDb()
    .prepare(
      `SELECT id, project_id, title, summary, created_at, updated_at, last_summarized_at
       FROM chats WHERE project_id = ? ORDER BY updated_at DESC`,
    )
    .all(projectId) as Chat[];
}

export function getChat(chatId: string): Chat | null {
  return (
    (getDb()
      .prepare(
        `SELECT id, project_id, title, summary, created_at, updated_at, last_summarized_at
         FROM chats WHERE id = ?`,
      )
      .get(chatId) as Chat | null) ?? null
  );
}

export function createChat(projectId: string, title = "New chat"): Chat {
  const chat: Chat = {
    id: nanoid(),
    project_id: projectId,
    title,
    summary: "",
    created_at: nowIso(),
    updated_at: nowIso(),
    last_summarized_at: null,
  };
  getDb()
    .prepare(
      `INSERT INTO chats (id, project_id, title, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      chat.id,
      chat.project_id,
      chat.title,
      chat.summary,
      chat.created_at,
      chat.updated_at,
    );
  return chat;
}

export function updateChatSummary(
  chatId: string,
  summary: string,
  lastSummarizedAt?: string,
): void {
  getDb()
    .prepare(
      "UPDATE chats SET summary = ?, last_summarized_at = ?, updated_at = ? WHERE id = ?",
    )
    .run(summary, lastSummarizedAt ?? nowIso(), nowIso(), chatId);
}

export function updateChatTitle(chatId: string, title: string): void {
  getDb()
    .prepare("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, nowIso(), chatId);
}

export function touchChat(chatId: string): void {
  getDb()
    .prepare("UPDATE chats SET updated_at = ? WHERE id = ?")
    .run(nowIso(), chatId);
}

export function deleteChat(chatId: string): boolean {
  const result = getDb().prepare("DELETE FROM chats WHERE id = ?").run(chatId);
  return result.changes > 0;
}

const MESSAGE_COLUMNS = `id, chat_id, role, content, tool_calls_json, tool_call_id,
  tool_name, created_at, sources_json, elapsed_ms, first_token_ms`;

export function listMessages(chatId: string): Message[] {
  return getDb()
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages WHERE chat_id = ? ORDER BY created_at ASC`,
    )
    .all(chatId) as Message[];
}

/** Conversational messages created strictly after the given ISO timestamp. */
export function listMessagesAfter(
  chatId: string,
  afterIso: string | null,
): Message[] {
  if (!afterIso) return listMessages(chatId);
  return getDb()
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages WHERE chat_id = ? AND created_at > ?
       ORDER BY created_at ASC`,
    )
    .all(chatId, afterIso) as Message[];
}

export function insertMessage(
  message: Omit<
    Message,
    "id" | "created_at" | "sources_json" | "elapsed_ms" | "first_token_ms"
  > & {
    id?: string;
    sources_json?: string | null;
    elapsed_ms?: number | null;
    first_token_ms?: number | null;
  },
): Message {
  const row: Message = {
    id: message.id ?? nanoid(),
    chat_id: message.chat_id,
    role: message.role,
    content: message.content,
    tool_calls_json: message.tool_calls_json ?? null,
    tool_call_id: message.tool_call_id ?? null,
    tool_name: message.tool_name ?? null,
    created_at: nowIso(),
    sources_json: message.sources_json ?? null,
    elapsed_ms: message.elapsed_ms ?? null,
    first_token_ms: message.first_token_ms ?? null,
  };
  getDb()
    .prepare(
      `INSERT INTO messages (id, chat_id, role, content, tool_calls_json, tool_call_id,
        tool_name, created_at, sources_json, elapsed_ms, first_token_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.chat_id,
      row.role,
      row.content,
      row.tool_calls_json,
      row.tool_call_id,
      row.tool_name,
      row.created_at,
      row.sources_json,
      row.elapsed_ms,
      row.first_token_ms,
    );
  touchChat(row.chat_id);
  return row;
}

export function getMessage(messageId: string): Message | null {
  return (
    (getDb()
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`,
      )
      .get(messageId) as Message | null) ?? null
  );
}

export function getLastUserMessage(chatId: string): Message | null {
  return (
    (getDb()
      .prepare(
        `SELECT ${MESSAGE_COLUMNS}
         FROM messages WHERE chat_id = ? AND role = 'user'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(chatId) as Message | null) ?? null
  );
}

export function truncateMessagesAfter(chatId: string, messageId: string): void {
  const message = getMessage(messageId);
  if (!message || message.chat_id !== chatId) return;
  getDb()
    .prepare(
      "DELETE FROM messages WHERE chat_id = ? AND created_at > ?",
    )
    .run(chatId, message.created_at);
  touchChat(chatId);
}

export function truncateMessagesFrom(chatId: string, messageId: string): void {
  const message = getMessage(messageId);
  if (!message || message.chat_id !== chatId) return;
  getDb()
    .prepare(
      "DELETE FROM messages WHERE chat_id = ? AND created_at >= ?",
    )
    .run(chatId, message.created_at);
  touchChat(chatId);
}

export function countUserMessages(chatId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM messages WHERE chat_id = ? AND role = 'user'")
    .get(chatId) as { count: number };
  return row.count;
}

export function saveMemory(
  projectId: string,
  content: string,
  chatId?: string | null,
): Memory {
  const memory: Memory = {
    id: nanoid(),
    project_id: projectId,
    chat_id: chatId ?? null,
    content,
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      "INSERT INTO memories (id, project_id, chat_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      memory.id,
      memory.project_id,
      memory.chat_id,
      memory.content,
      memory.created_at,
    );
  return memory;
}

export function listMemories(
  projectId: string,
  chatId?: string | null,
  query?: string,
): Memory[] {
  const db = getDb();
  if (query?.trim()) {
    const pattern = `%${query.trim()}%`;
    if (chatId) {
      return db
        .prepare(
          `SELECT id, project_id, chat_id, content, created_at FROM memories
           WHERE project_id = ? AND (chat_id IS NULL OR chat_id = ?) AND content LIKE ?
           ORDER BY created_at DESC LIMIT 20`,
        )
        .all(projectId, chatId, pattern) as Memory[];
    }
    return db
      .prepare(
        `SELECT id, project_id, chat_id, content, created_at FROM memories
         WHERE project_id = ? AND content LIKE ?
         ORDER BY created_at DESC LIMIT 20`,
      )
      .all(projectId, pattern) as Memory[];
  }

  if (chatId) {
    return db
      .prepare(
        `SELECT id, project_id, chat_id, content, created_at FROM memories
         WHERE project_id = ? AND (chat_id IS NULL OR chat_id = ?)
         ORDER BY created_at DESC LIMIT 20`,
      )
      .all(projectId, chatId) as Memory[];
  }

  return db
    .prepare(
      `SELECT id, project_id, chat_id, content, created_at FROM memories
       WHERE project_id = ? ORDER BY created_at DESC LIMIT 20`,
    )
    .all(projectId) as Memory[];
}

export function ftsSearch(
  projectId: string,
  query: string,
  limit = 8,
): SearchResult[] {
  // Tokenize, strip FTS5 special characters, quote each surviving token as a
  // literal so punctuation in the query can never produce a syntax error.
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 || /\d/.test(t));

  if (tokens.length === 0) return [];

  const quoted = tokens.map((t) => `"${t.replaceAll('"', '""')}"`);
  // Phrase match (all tokens adjacent) is highly relevant; OR of tokens gives
  // recall. bm25 ranking favours the phrase hits naturally.
  const terms =
    tokens.length > 1
      ? `(${quoted.join(" ")}) OR ${quoted.join(" OR ")}`
      : quoted.join(" OR ");

  const rows = getDb()
    .prepare(
      `SELECT fc.id as chunk_id, fc.file_id, f.filename, fc.content, fc.start_line, fc.end_line,
              bm25(file_chunks_fts) as score
       FROM file_chunks_fts
       JOIN file_chunks fc ON fc.id = file_chunks_fts.chunk_id
       JOIN files f ON f.id = fc.file_id
       WHERE file_chunks_fts MATCH ? AND f.project_id = ?
       ORDER BY score
       LIMIT ?`,
    )
    .all(terms, projectId, limit) as Array<{
    chunk_id: string;
    file_id: string;
    filename: string;
    content: string;
    start_line: number;
    end_line: number;
    score: number;
  }>;

  return rows.map((row) => ({
    chunk_id: row.chunk_id,
    file_id: row.file_id,
    filename: row.filename,
    content: row.content,
    start_line: row.start_line,
    end_line: row.end_line,
    score: Math.abs(row.score),
  }));
}

export function vectorSearch(
  projectId: string,
  embedding: Float32Array,
  limit = 8,
): SearchResult[] {
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT cv.chunk_id, fc.file_id, f.filename, fc.content, fc.start_line, fc.end_line,
                cv.distance as score
         FROM chunk_vectors cv
         JOIN file_chunks fc ON fc.id = cv.chunk_id
         JOIN files f ON f.id = fc.file_id
         WHERE f.project_id = ?
           AND cv.embedding MATCH ?
           AND k = ?
         ORDER BY score`,
      )
      .all(projectId, Buffer.from(embedding.buffer), limit) as Array<{
      chunk_id: string;
      file_id: string;
      filename: string;
      content: string;
      start_line: number;
      end_line: number;
      score: number;
    }>;

    return rows.map((row) => ({
      chunk_id: row.chunk_id,
      file_id: row.file_id,
      filename: row.filename,
      content: row.content,
      start_line: row.start_line,
      end_line: row.end_line,
      score: row.score,
    }));
  } catch {
    return bruteForceVectorSearch(projectId, embedding, limit);
  }
}

function bruteForceVectorSearch(
  projectId: string,
  queryEmbedding: Float32Array,
  limit: number,
): SearchResult[] {
  const rows = getDb()
    .prepare(
      `SELECT ce.chunk_id, ce.embedding, fc.file_id, f.filename, fc.content, fc.start_line, fc.end_line
       FROM chunk_embeddings ce
       JOIN file_chunks fc ON fc.id = ce.chunk_id
       JOIN files f ON f.id = fc.file_id
       WHERE f.project_id = ?`,
    )
    .all(projectId) as Array<{
    chunk_id: string;
    embedding: Buffer;
    file_id: string;
    filename: string;
    content: string;
    start_line: number;
    end_line: number;
  }>;

  const scored = rows.map((row) => {
    const vec = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4,
    );
    return {
      chunk_id: row.chunk_id,
      file_id: row.file_id,
      filename: row.filename,
      content: row.content,
      start_line: row.start_line,
      end_line: row.end_line,
      score: cosineDistance(queryEmbedding, vec),
    };
  });

  return scored.sort((a, b) => a.score - b.score).slice(0, limit);
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function reciprocalRankFusion(
  lists: SearchResult[][],
  k = 60,
): SearchResult[] {
  const scores = new Map<string, SearchResult & { fused: number }>();

  for (const list of lists) {
    list.forEach((item, index) => {
      const rank = index + 1;
      const existing = scores.get(item.chunk_id);
      const contribution = 1 / (k + rank);
      if (existing) {
        existing.fused += contribution;
      } else {
        scores.set(item.chunk_id, { ...item, fused: contribution });
      }
    });
  }

  return [...scores.values()]
    .sort((a, b) => b.fused - a.fused)
    .map(({ fused: _fused, ...rest }) => ({ ...rest, score: _fused }));
}

/** Fetch persisted embeddings for the given chunk ids (for reranking/MMR). */
export function getChunkEmbeddings(
  chunkIds: string[],
): Map<string, Float32Array> {
  const result = new Map<string, Float32Array>();
  if (chunkIds.length === 0) return result;

  const placeholders = chunkIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT chunk_id, embedding FROM chunk_embeddings WHERE chunk_id IN (${placeholders})`,
    )
    .all(...chunkIds) as Array<{ chunk_id: string; embedding: Buffer }>;

  for (const row of rows) {
    result.set(
      row.chunk_id,
      new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4,
      ),
    );
  }
  return result;
}

export function getChunkById(chunkId: string): SearchResult | null {
  const row = getDb()
    .prepare(
      `SELECT fc.id as chunk_id, fc.file_id, f.filename, fc.content, fc.start_line, fc.end_line
       FROM file_chunks fc
       JOIN files f ON f.id = fc.file_id
       WHERE fc.id = ?`,
    )
    .get(chunkId) as {
    chunk_id: string;
    file_id: string;
    filename: string;
    content: string;
    start_line: number;
    end_line: number;
  } | null;

  if (!row) return null;
  return { ...row, score: 0 };
}
