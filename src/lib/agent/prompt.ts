import type OpenAI from "openai";
import {
  getChat,
  getSettings,
  listMemories,
  listMessages,
} from "../db/queries";
import type { Message } from "../db/types";
import { formatSearchResults } from "../rag/search";
import type { SearchResult } from "../db/types";
import { getSystemPrompt } from "./tools";

const MAX_HISTORY_TOOL_CHARS = 4_000;
const IDENTITY_TOKEN_CAP = 600;
const SUMMARY_TOKEN_CAP = 600;
const MEMORY_TOKEN_CAP = 400;
// Share of the remaining (post identity/summary/memory) budget given to
// retrieved evidence before history fills the rest.
const EVIDENCE_BUDGET_SHARE = 0.6;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimToBudget(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (estimateTokens(text) <= budget) return text;
  const maxChars = budget * 4;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

type MessageGroup =
  | { kind: "single"; message: Message }
  | { kind: "tool_turn"; assistant: Message; tools: Message[] };

function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index]!;
    if (message.role === "assistant" && message.tool_calls_json) {
      const tools: Message[] = [];
      index += 1;
      while (index < messages.length && messages[index]!.role === "tool") {
        tools.push(messages[index]!);
        index += 1;
      }
      groups.push({ kind: "tool_turn", assistant: message, tools });
      continue;
    }

    groups.push({ kind: "single", message });
    index += 1;
  }

  return groups;
}

function groupToParams(group: MessageGroup): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (group.kind === "single") {
    const param = messageToParam(group.message);
    return param ? [param] : [];
  }

  const expectedToolCalls = parseToolCallCount(group.assistant.tool_calls_json);
  if (expectedToolCalls > 0 && group.tools.length !== expectedToolCalls) {
    // Orphaned tool calls break tool-aware models — drop the incomplete turn.
    return [];
  }

  const assistant = messageToParam(group.assistant);
  if (!assistant) return [];

  return [
    assistant,
    ...group.tools
      .map((tool) => messageToParam(tool))
      .filter((param): param is OpenAI.Chat.Completions.ChatCompletionMessageParam => param !== null),
  ];
}

function parseToolCallCount(toolCallsJson: string | null): number {
  if (!toolCallsJson) return 0;
  try {
    const toolCalls = JSON.parse(toolCallsJson) as unknown[];
    return Array.isArray(toolCalls) ? toolCalls.length : 0;
  } catch {
    return 0;
  }
}

function estimateGroupTokens(group: MessageGroup): number {
  return groupToParams(group).reduce((total, param) => {
    const content =
      typeof param.content === "string" ? param.content : JSON.stringify(param);
    return total + estimateTokens(content);
  }, 0);
}

export interface BuiltPrompt {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  usedTokens: number;
  budget: number;
}

export function buildPromptMessages(options: {
  projectId: string;
  chatId: string;
  retrievedChunks: SearchResult[];
  excludeMessageId?: string;
  /** Total token budget for the whole prompt (excludes the response reserve). */
  promptBudget: number;
  /** Query used to select relevant memories (typically the rewritten query). */
  memoryQuery?: string;
}): BuiltPrompt {
  const settings = getSettings();
  const chat = getChat(options.chatId);
  const allMessages = listMessages(options.chatId).filter(
    (m) => m.id !== options.excludeMessageId,
  );

  const budget = Math.max(options.promptBudget, 512);
  let remaining = budget;

  // 1. Identity / system instructions (highest priority).
  const identity = trimToBudget(
    getSystemPrompt(options.projectId),
    Math.min(IDENTITY_TOKEN_CAP, remaining),
  );
  remaining -= estimateTokens(identity);

  // 2. Rolling conversation summary.
  let summaryBlock = "";
  if (chat?.summary && remaining > 0) {
    summaryBlock = trimToBudget(
      `Conversation summary so far:\n${chat.summary}`,
      Math.min(SUMMARY_TOKEN_CAP, remaining),
    );
    remaining -= estimateTokens(summaryBlock);
  }

  // 3. Auto-injected relevant memories.
  let memoryBlock = "";
  if (settings.auto_inject_memories && remaining > 0) {
    const memories = listMemories(
      options.projectId,
      options.chatId,
      options.memoryQuery,
    ).slice(0, 8);
    if (memories.length > 0) {
      const formatted = `Relevant saved memories:\n${memories
        .map((m) => `- ${m.content}`)
        .join("\n")}`;
      memoryBlock = trimToBudget(
        formatted,
        Math.min(MEMORY_TOKEN_CAP, remaining),
      );
      remaining -= estimateTokens(memoryBlock);
    }
  }

  const systemContent = [identity, summaryBlock, memoryBlock]
    .filter(Boolean)
    .join("\n\n");

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
  ];
  let usedTokens = estimateTokens(systemContent);

  // 4. Retrieved evidence as its own message, sized by a dedicated budget so it
  //    is never throttled by the identity/summary block.
  if (options.retrievedChunks.length > 0 && remaining > 0) {
    const evidenceBudget = Math.max(
      Math.floor(remaining * EVIDENCE_BUDGET_SHARE),
      0,
    );
    const evidence = trimToBudget(
      `Pre-retrieved excerpts from the project files for the current question. Ground your answer in these and cite filename + line range:\n\n${formatSearchResults(
        options.retrievedChunks,
      )}`,
      evidenceBudget,
    );
    if (evidence) {
      messages.push({ role: "system", content: evidence });
      const evidenceTokens = estimateTokens(evidence);
      usedTokens += evidenceTokens;
      remaining -= evidenceTokens;
    }
  }

  // 5. Recent conversation history fills whatever budget is left.
  const recentMessages = selectRecentMessages(
    allMessages,
    settings.recent_turns_limit,
  );
  const groups = groupMessages(recentMessages);
  const includedGroups: MessageGroup[] = [];

  let historyBudget = remaining;
  for (const group of [...groups].reverse()) {
    const groupTokens = estimateGroupTokens(group);
    if (groupTokens > historyBudget) continue;
    includedGroups.unshift(group);
    historyBudget -= groupTokens;
    usedTokens += groupTokens;
  }

  for (const group of includedGroups) {
    messages.push(...groupToParams(group));
  }

  return { messages, usedTokens, budget };
}

function selectRecentMessages(
  messages: Message[],
  turnLimit: number,
): Message[] {
  const conversational = messages.filter((m) =>
    ["user", "assistant", "tool"].includes(m.role),
  );
  const userIndices = conversational
    .map((m, i) => (m.role === "user" ? i : -1))
    .filter((i) => i >= 0);
  if (userIndices.length <= turnLimit) return conversational;

  const startIndex = userIndices[userIndices.length - turnLimit] ?? 0;
  return conversational.slice(startIndex);
}

function messageToParam(
  message: Message,
): OpenAI.Chat.Completions.ChatCompletionMessageParam | null {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.content };
    case "assistant": {
      if (message.tool_calls_json) {
        try {
          const toolCalls = JSON.parse(
            message.tool_calls_json,
          ) as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
          return {
            role: "assistant",
            content: message.content || null,
            tool_calls: toolCalls,
          };
        } catch {
          return { role: "assistant", content: message.content };
        }
      }
      return { role: "assistant", content: message.content };
    }
    case "tool": {
      const content =
        message.content.length > MAX_HISTORY_TOOL_CHARS
          ? `${message.content.slice(0, MAX_HISTORY_TOOL_CHARS)}\n...[truncated]`
          : message.content;
      return {
        role: "tool",
        tool_call_id: message.tool_call_id ?? "",
        content,
      };
    }
    case "system":
      return { role: "system", content: message.content };
    default: {
      const _exhaustive: never = message.role;
      return _exhaustive;
    }
  }
}
