import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { DATA_DIR, DB_PATH } from "./paths";
import { DEFAULT_SETTINGS } from "./types";

let dbInstance: Database | null = null;
let vecEnabled = false;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    indexed_at TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    index_status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS file_chunks (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chunk_embeddings (
    chunk_id TEXT PRIMARY KEY REFERENCES file_chunks(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS file_chunks_fts USING fts5(
    chunk_id UNINDEXED,
    file_id UNINDEXED,
    filename,
    content,
    tokenize = 'porter'
  )`,
  `CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls_json TEXT,
    tool_call_id TEXT,
    tool_name TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_file ON file_chunks(file_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id)`,
];

// Additive columns introduced after the initial schema. Each is applied with
// a guarded ALTER (bun:sqlite throws if the column already exists) since there
// is no migration-version runner.
const COLUMN_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: "files", column: "embedding_model", ddl: "ALTER TABLE files ADD COLUMN embedding_model TEXT" },
  { table: "chats", column: "last_summarized_at", ddl: "ALTER TABLE chats ADD COLUMN last_summarized_at TEXT" },
  { table: "messages", column: "sources_json", ddl: "ALTER TABLE messages ADD COLUMN sources_json TEXT" },
  { table: "messages", column: "elapsed_ms", ddl: "ALTER TABLE messages ADD COLUMN elapsed_ms INTEGER" },
  { table: "messages", column: "first_token_ms", ddl: "ALTER TABLE messages ADD COLUMN first_token_ms INTEGER" },
];

function columnExists(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.some((row) => row.name === column);
}

function applyColumnMigrations(db: Database): void {
  for (const migration of COLUMN_MIGRATIONS) {
    if (columnExists(db, migration.table, migration.column)) continue;
    try {
      db.exec(migration.ddl);
    } catch {
      // Column may already exist from a concurrent init; ignore.
    }
  }
}

function seedSettings(db: Database): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insert.run(key, JSON.stringify(value));
  }
}

function tryLoadVec(db: Database): boolean {
  try {
    sqliteVec.load(db);
    return true;
  } catch {
    return false;
  }
}

let vecTableDimensions: number | null = null;

const VEC_DIM_KEY = "__chunk_vectors_dim";

function readStoredVecDimensions(db: Database): number | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(VEC_DIM_KEY) as { value: string } | null;
  if (!row) return null;
  const parsed = Number(JSON.parse(row.value));
  return Number.isFinite(parsed) ? parsed : null;
}

function writeStoredVecDimensions(db: Database, dimensions: number): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(VEC_DIM_KEY, JSON.stringify(dimensions));
}

function vecTableExists(db: Database): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunk_vectors'",
    )
    .get();
  return row != null;
}

/**
 * Ensure the sqlite-vec virtual table exists for the given embedding dimension.
 *
 * Non-destructive: only drops and rebuilds when the dimension actually changes
 * (or the table is missing). When a rebuild happens, vectors are re-populated
 * from the persisted `chunk_embeddings` BLOBs so other files are not wiped.
 */
export function ensureVecTable(dimensions: number): void {
  const db = getDb();
  if (!vecEnabled) return;

  if (vecTableExists(db) && vecTableDimensions === dimensions) {
    return;
  }

  const dimensionChanged =
    vecTableDimensions !== null && vecTableDimensions !== dimensions;

  if (!vecTableExists(db)) {
    db.exec(
      `CREATE VIRTUAL TABLE chunk_vectors USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[${dimensions}]
      )`,
    );
    vecTableDimensions = dimensions;
    writeStoredVecDimensions(db, dimensions);
    rebuildVectorsFromEmbeddings(db, dimensions);
    return;
  }

  if (dimensionChanged) {
    db.exec("DROP TABLE IF EXISTS chunk_vectors");
    db.exec(
      `CREATE VIRTUAL TABLE chunk_vectors USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[${dimensions}]
      )`,
    );
    vecTableDimensions = dimensions;
    writeStoredVecDimensions(db, dimensions);
    rebuildVectorsFromEmbeddings(db, dimensions);
  }
}

/** Re-populate chunk_vectors from the durable chunk_embeddings BLOB table. */
function rebuildVectorsFromEmbeddings(db: Database, dimensions: number): void {
  const rows = db
    .prepare("SELECT chunk_id, embedding FROM chunk_embeddings")
    .all() as Array<{ chunk_id: string; embedding: Buffer }>;

  const insert = db.prepare(
    "INSERT OR REPLACE INTO chunk_vectors (chunk_id, embedding) VALUES (?, ?)",
  );
  for (const row of rows) {
    const floats = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4,
    );
    if (floats.length !== dimensions) continue;
    try {
      insert.run(row.chunk_id, row.embedding);
    } catch {
      // skip malformed rows
    }
  }
}

export function getDb(): Database {
  if (dbInstance) return dbInstance;

  mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");

  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }
  applyColumnMigrations(db);

  vecEnabled = tryLoadVec(db);
  seedSettings(db);
  vecTableDimensions = readStoredVecDimensions(db);

  dbInstance = db;
  return db;
}

export function isVecEnabled(): boolean {
  getDb();
  return vecEnabled;
}

export function closeDb(): void {
  dbInstance?.close();
  dbInstance = null;
}
