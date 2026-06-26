export interface AppSettings {
  lmstudio_base_url: string;
  chat_model: string;
  embedding_model: string;
  context_window_budget: number;
  summary_every_n_turns: number;
  recent_turns_limit: number;
  max_tool_iterations: number;
  embedding_dimensions: number;
  /** Total model context window in tokens. 0 = auto-detect from LM Studio. */
  model_context_window: number;
  /** Tokens reserved for the model's response (also used as max_tokens). */
  response_token_reserve: number;
  /** Number of chunks injected as pre-retrieved evidence per turn. */
  retrieval_top_k: number;
  /** Candidate pool size fetched before reranking/dedup/MMR. */
  retrieval_candidate_pool: number;
  /** Target characters per chunk when indexing files. */
  chunk_target_chars: number;
  /** Overlap characters between adjacent chunks. */
  chunk_overlap: number;
  /** Rewrite follow-up questions into standalone search queries. */
  enable_query_rewrite: boolean;
  /** Auto-inject relevant saved memories into the prompt. */
  auto_inject_memories: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  lmstudio_base_url: "http://127.0.0.1:1234/v1",
  chat_model: "",
  embedding_model: "",
  context_window_budget: 6000,
  summary_every_n_turns: 8,
  recent_turns_limit: 10,
  max_tool_iterations: 8,
  embedding_dimensions: 768,
  model_context_window: 0,
  response_token_reserve: 1024,
  retrieval_top_k: 6,
  retrieval_candidate_pool: 20,
  chunk_target_chars: 1400,
  chunk_overlap: 200,
  enable_query_rewrite: true,
  auto_inject_memories: true,
};

export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export type IndexStatus =
  | "pending"
  | "converting"
  | "indexing"
  | "indexed"
  | "fts_only"
  | "error";

export interface ProjectFile {
  id: string;
  project_id: string;
  filename: string;
  relative_path: string;
  mime: string;
  size: number;
  indexed_at: string | null;
  chunk_count: number;
  index_status: IndexStatus;
  error_message: string | null;
  /** Embedding model used at index time (for staleness detection). */
  embedding_model: string | null;
  /** On-disk path to the uploaded original when conversion was required. */
  original_relative_path: string | null;
  /** MIME type of the uploaded original (before conversion). */
  source_mime: string | null;
}

export interface FileChunk {
  id: string;
  file_id: string;
  chunk_index: number;
  content: string;
  start_line: number;
  end_line: number;
}

export interface Chat {
  id: string;
  project_id: string;
  title: string;
  summary: string;
  created_at: string;
  updated_at: string;
  /** ISO timestamp of the last message folded into the rolling summary. */
  last_summarized_at: string | null;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

/** A document chunk that grounded an assistant answer. */
export interface SourceRef {
  chunk_id: string;
  file_id: string;
  filename: string;
  start_line: number;
  end_line: number;
  score: number;
}

export interface Message {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  created_at: string;
  /** JSON-encoded SourceRef[] of chunks that grounded an assistant answer. */
  sources_json: string | null;
  /** Total generation time in milliseconds (assistant messages). */
  elapsed_ms: number | null;
  /** Time to first streamed token in milliseconds (assistant messages). */
  first_token_ms: number | null;
}

export interface Memory {
  id: string;
  project_id: string;
  chat_id: string | null;
  content: string;
  created_at: string;
}

export interface SearchResult {
  chunk_id: string;
  file_id: string;
  filename: string;
  content: string;
  start_line: number;
  end_line: number;
  score: number;
}
