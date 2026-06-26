import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type OpenAI from "openai";
import {
  getChat,
  getFile,
  getSettings,
  listFiles,
  listMemories,
  saveMemory,
} from "../db/queries";
import { projectFilesDir } from "../db/paths";
import { hybridSearch } from "../rag/search";
import type { SearchResult } from "../db/types";

const MAX_READ_FILE_CHARS = 12_000;
const MAX_TOOL_RESULT_CHARS = 6_000;

function truncateToolOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated — use search_documents, grep_files, or a line range with read_file]`;
}

export const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "search_documents",
        description:
          "Search project files using semantic and keyword retrieval. Use this first when answering questions about uploaded documents.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: {
              type: "number",
              description: "Maximum number of chunks to return (default 8)",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description:
          "Read a project file by filename. Optionally specify line range.",
        parameters: {
          type: "object",
          properties: {
            filename: { type: "string" },
            start_line: { type: "number" },
            end_line: { type: "number" },
          },
          required: ["filename"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "grep_files",
        description:
          "Search for a keyword or phrase across all project files (case-insensitive).",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string" },
            limit: { type: "number" },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List all files in the project with indexing status.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "save_memory",
        description:
          "Save an important fact to persistent memory for future turns in this project.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string" },
          },
          required: ["content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "recall_memory",
        description: "Retrieve saved memories for this project or chat.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_conversation_summary",
        description: "Get the rolling summary of the current conversation.",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

export async function executeTool(
  projectId: string,
  chatId: string,
  name: string,
  argsJson: string,
  collectSources?: (results: SearchResult[]) => void,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return "Error: invalid tool arguments JSON";
  }

  switch (name) {
    case "search_documents": {
      const query = String(args.query ?? "");
      const limit = Number(args.limit ?? 8);
      const results = await hybridSearch(projectId, query, limit);
      collectSources?.(results);
      if (results.length === 0) return "No results found.";
      return truncateToolOutput(
        results
          .map(
            (r) =>
              `${r.filename} (lines ${r.start_line}-${r.end_line}):\n${r.content}`,
          )
          .join("\n\n---\n\n"),
        MAX_TOOL_RESULT_CHARS,
      );
    }
    case "read_file": {
      const filename = String(args.filename ?? "");
      const files = listFiles(projectId);
      const file = files.find(
        (f) => f.filename === filename || f.relative_path === filename,
      );
      if (!file) return `File not found: ${filename}`;
      const path = join(projectFilesDir(projectId), file.relative_path);
      const content = await readFile(path, "utf8");
      const lines = content.split("\n");
      const start = Number(args.start_line ?? 1);
      const end = Number(args.end_line ?? Math.min(lines.length, start + 199));
      const slice = lines.slice(Math.max(start - 1, 0), end).join("\n");
      const header = `File: ${file.filename}\nLines ${start}-${end} of ${lines.length}:\n`;
      return truncateToolOutput(`${header}${slice}`, MAX_READ_FILE_CHARS);
    }
    case "grep_files": {
      const pattern = String(args.pattern ?? "").toLowerCase();
      const limit = Number(args.limit ?? 20);
      if (!pattern) return "Pattern is required.";
      const files = listFiles(projectId);
      const matches: string[] = [];
      for (const file of files) {
        const path = join(projectFilesDir(projectId), file.relative_path);
        const content = await readFile(path, "utf8");
        const lines = content.split("\n");
        for (const [index, line] of lines.entries()) {
          if (line.toLowerCase().includes(pattern)) {
            matches.push(
              `${file.filename}:${index + 1}: ${line.trim().slice(0, 200)}`,
            );
            if (matches.length >= limit) break;
          }
        }
        if (matches.length >= limit) break;
      }
      return matches.length > 0
        ? matches.join("\n")
        : `No matches for "${pattern}"`;
    }
    case "list_files": {
      const files = listFiles(projectId);
      if (files.length === 0) return "No files uploaded yet.";
      return files
        .map(
          (f) =>
            `- ${f.filename} (${f.size} bytes, ${f.chunk_count} chunks, status: ${f.index_status})`,
        )
        .join("\n");
    }
    case "save_memory": {
      const content = String(args.content ?? "").trim();
      if (!content) return "Memory content is required.";
      saveMemory(projectId, content, chatId);
      return "Memory saved.";
    }
    case "recall_memory": {
      const query = args.query ? String(args.query) : undefined;
      const memories = listMemories(projectId, chatId, query);
      if (memories.length === 0) return "No memories found.";
      return memories.map((m) => `- ${m.content}`).join("\n");
    }
    case "get_conversation_summary": {
      const chat = getChat(chatId);
      return chat?.summary || "No summary yet.";
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

export function getSystemPrompt(projectId: string): string {
  const settings = getSettings();
  const files = listFiles(projectId);
  const fileList =
    files.length > 0
      ? files.map((f) => f.filename).join(", ")
      : "none yet";

  return `You are a local RAG assistant for a project's uploaded documents.
Project ID: ${projectId}
Files in project: ${fileList}

GROUNDING
- Base every factual claim on the project files. Pre-retrieved excerpts are provided in a system message; use them first.
- Cite sources inline as (filename, lines X-Y). The UI also shows a clickable Sources list, so citations must be accurate.
- If the answer is not in the retrieved excerpts, call search_documents or grep_files before answering. Prefer search_documents and grep_files over read_file for large files (context is limited).
- If the information genuinely is not in the files, say so plainly instead of guessing. Do not invent facts, filenames, or line numbers.

ANSWER STYLE
- Answer the user's latest question directly and specifically. Do not produce a generic document summary unless asked.
- Be insightful and well-structured: lead with the direct answer, then supporting detail. Synthesize across excerpts rather than dumping raw text. Use short paragraphs or bullet points.
- When asked about a specific topic (roles, requirements, dates, numbers, etc.), search/grep for that topic first, then answer in a focused way.

MEMORY
- Relevant saved memories may be injected automatically. When you learn durable facts or preferences the user wants remembered across long conversations, call save_memory.`;
}
