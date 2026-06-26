import type OpenAI from "openai";
import { createLmClient } from "../lmstudio/client";
import {
  countUserMessages,
  getSettings,
  insertMessage,
} from "../db/queries";
import type { SearchResult, SourceRef } from "../db/types";
import { hybridSearch } from "../rag/search";
import { buildPromptMessages, estimateTokens } from "./prompt";
import { computePromptBudget, resolveContextWindow } from "./budget";
import { rewriteQuery } from "./rewrite";
import {
  executeTool,
  TOOL_DEFINITIONS,
} from "./tools";
import {
  maybeGenerateTitle,
  maybeSummarizeChat,
  persistAssistantMessage,
} from "./summarize";

export interface GenerationStats {
  elapsedMs: number;
  firstTokenMs: number | null;
  tokens: number;
  tokensPerSecond: number;
  promptTokens: number;
  promptBudget: number;
  contextWindow: number;
}

export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "tool_result"; name: string; content: string }
  | { type: "sources"; items: SourceRef[] }
  | { type: "done"; messageId: string; stats?: GenerationStats }
  | { type: "aborted"; messageId: string }
  | { type: "error"; message: string };

export type ChatStreamMode = "send" | "rerun" | "edit";

const MAX_SOURCES = 12;

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}

function toSourceRef(result: SearchResult): SourceRef {
  return {
    chunk_id: result.chunk_id,
    file_id: result.file_id,
    filename: result.filename,
    start_line: result.start_line,
    end_line: result.end_line,
    score: result.score,
  };
}

export async function* runAgentStream(options: {
  projectId: string;
  chatId: string;
  userMessage: string;
  userMessageId: string;
  mode?: ChatStreamMode;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const settings = getSettings();
  if (!settings.chat_model) {
    yield { type: "error", message: "Configure a chat model in Settings first." };
    return;
  }

  const mode = options.mode ?? "send";
  const startTime = Date.now();

  // Rewrite follow-ups into a standalone retrieval query (history-aware).
  const searchQuery = await rewriteQuery(options.chatId, options.userMessage);

  const retrieved = await hybridSearch(
    options.projectId,
    searchQuery,
    settings.retrieval_top_k,
  );

  // Aggregate grounding sources: pre-retrieved chunks plus any returned by
  // search_documents tool calls during the turn.
  const sourceMap = new Map<string, SourceRef>();
  for (const result of retrieved) {
    if (!sourceMap.has(result.chunk_id)) {
      sourceMap.set(result.chunk_id, toSourceRef(result));
    }
  }
  const collectSources = (results: SearchResult[]) => {
    for (const result of results) {
      if (sourceMap.size >= MAX_SOURCES && !sourceMap.has(result.chunk_id)) {
        continue;
      }
      if (!sourceMap.has(result.chunk_id)) {
        sourceMap.set(result.chunk_id, toSourceRef(result));
      }
    }
  };

  // Resolve the model context window and derive the prompt budget; reserve
  // tokens for the response so weak/small models don't overflow.
  const contextWindow = await resolveContextWindow(settings);
  const promptBudget = computePromptBudget(contextWindow, settings);

  const built = buildPromptMessages({
    projectId: options.projectId,
    chatId: options.chatId,
    retrievedChunks: retrieved,
    excludeMessageId: mode === "send" ? options.userMessageId : undefined,
    promptBudget,
    memoryQuery: searchQuery,
  });
  const messages = built.messages;
  let promptTokens = built.usedTokens;

  if (mode === "send") {
    messages.push({ role: "user", content: options.userMessage });
    promptTokens += estimateTokens(options.userMessage);
  }

  if (mode === "send" && countUserMessages(options.chatId) === 1) {
    void maybeGenerateTitle(options.chatId, options.userMessage);
  }

  const client = createLmClient();
  let iterations = 0;
  let finalContent = "";
  let firstTokenMs: number | null = null;

  const buildStats = (): GenerationStats => {
    const elapsedMs = Date.now() - startTime;
    const tokens = estimateTokens(finalContent);
    return {
      elapsedMs,
      firstTokenMs,
      tokens,
      tokensPerSecond: elapsedMs > 0 ? (tokens / elapsedMs) * 1000 : 0,
      promptTokens,
      promptBudget,
      contextWindow,
    };
  };

  const sourceItems = (): SourceRef[] => [...sourceMap.values()];

  while (iterations < settings.max_tool_iterations) {
    if (isAborted(options.signal)) {
      if (finalContent.trim()) {
        persistAssistantMessage(options.chatId, finalContent, null, {
          sources_json: JSON.stringify(sourceItems()),
          elapsed_ms: Date.now() - startTime,
          first_token_ms: firstTokenMs,
        });
      }
      yield { type: "aborted", messageId: options.userMessageId };
      return;
    }

    iterations += 1;

    const response = await client.chat.completions.create(
      {
        model: settings.chat_model,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        stream: true,
        max_tokens: settings.response_token_reserve,
      },
      { signal: options.signal },
    );

    let assistantContent = "";
    const toolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    for await (const chunk of response) {
      if (isAborted(options.signal)) {
        if (assistantContent.trim()) {
          persistAssistantMessage(options.chatId, assistantContent, null, {
            sources_json: JSON.stringify(sourceItems()),
            elapsed_ms: Date.now() - startTime,
            first_token_ms: firstTokenMs,
          });
        }
        yield { type: "aborted", messageId: options.userMessageId };
        return;
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        if (firstTokenMs === null) firstTokenMs = Date.now() - startTime;
        assistantContent += delta.content;
        finalContent += delta.content;
        yield { type: "token", content: delta.content };
      }

      if (delta.tool_calls) {
        for (const toolDelta of delta.tool_calls) {
          const index = toolDelta.index ?? 0;
          const existing = toolCalls.get(index) ?? {
            id: toolDelta.id ?? "",
            name: toolDelta.function?.name ?? "",
            arguments: "",
          };
          if (toolDelta.id) existing.id = toolDelta.id;
          if (toolDelta.function?.name) existing.name = toolDelta.function.name;
          if (toolDelta.function?.arguments) {
            existing.arguments += toolDelta.function.arguments;
          }
          toolCalls.set(index, existing);
        }
      }
    }

    if (toolCalls.size === 0) {
      const sources = sourceItems();
      persistAssistantMessage(options.chatId, assistantContent, null, {
        sources_json: JSON.stringify(sources),
        elapsed_ms: Date.now() - startTime,
        first_token_ms: firstTokenMs,
      });
      await maybeSummarizeChat(options.chatId);
      if (sources.length > 0) yield { type: "sources", items: sources };
      yield {
        type: "done",
        messageId: options.userMessageId,
        stats: buildStats(),
      };
      return;
    }

    const serializedToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] =
      [...toolCalls.values()].map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));

    persistAssistantMessage(
      options.chatId,
      assistantContent,
      JSON.stringify(serializedToolCalls),
    );

    messages.push({
      role: "assistant",
      content: assistantContent || null,
      tool_calls: serializedToolCalls,
    });

    for (const toolCall of serializedToolCalls) {
      yield {
        type: "tool_call",
        name: toolCall.function.name,
        args: toolCall.function.arguments,
      };

      const result = await executeTool(
        options.projectId,
        options.chatId,
        toolCall.function.name,
        toolCall.function.arguments,
        collectSources,
      );

      yield {
        type: "tool_result",
        name: toolCall.function.name,
        content: result.slice(0, 500),
      };

      insertMessage({
        chat_id: options.chatId,
        role: "tool",
        content: result,
        tool_call_id: toolCall.id,
        tool_name: toolCall.function.name,
        tool_calls_json: null,
      });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    finalContent = "";
  }

  if (!finalContent) {
    const fallback = buildRetrievalFallback(retrieved);
    yield { type: "token", content: fallback };
    persistAssistantMessage(options.chatId, fallback, null, {
      sources_json: JSON.stringify(sourceItems()),
      elapsed_ms: Date.now() - startTime,
      first_token_ms: firstTokenMs,
    });
  }

  await maybeSummarizeChat(options.chatId);
  const sources = sourceItems();
  if (sources.length > 0) yield { type: "sources", items: sources };
  yield {
    type: "done",
    messageId: options.userMessageId,
    stats: buildStats(),
  };
}

/**
 * Synthesized fallback when the tool loop is exhausted with no final answer.
 * Presents the strongest retrieved excerpts so even weak tool-callers return
 * something grounded.
 */
function buildRetrievalFallback(retrieved: SearchResult[]): string {
  if (retrieved.length === 0) {
    return "I could not find relevant information in the project files. Try rephrasing or upload more documents.";
  }
  const excerpt = retrieved
    .slice(0, 3)
    .map(
      (r) =>
        `From ${r.filename} (lines ${r.start_line}-${r.end_line}):\n${r.content.slice(0, 600)}`,
    )
    .join("\n\n");
  return `Here is the most relevant information I found in the project files:\n\n${excerpt}`;
}
