import { createLmClient } from "../lmstudio/client";
import {
  countUserMessages,
  getChat,
  getSettings,
  insertMessage,
  listMessagesAfter,
  updateChatSummary,
  updateChatTitle,
} from "../db/queries";
import type { Message } from "../db/types";

const MAX_TRANSCRIPT_CHARS = 8_000;

function formatTranscript(messages: Message[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      lines.push(`User: ${message.content}`);
    } else if (message.role === "assistant" && message.content.trim()) {
      lines.push(`Assistant: ${message.content}`);
    } else if (message.role === "tool" && message.tool_name) {
      lines.push(`[tool ${message.tool_name} returned results]`);
    }
  }
  const transcript = lines.join("\n");
  return transcript.length > MAX_TRANSCRIPT_CHARS
    ? `${transcript.slice(-MAX_TRANSCRIPT_CHARS)}`
    : transcript;
}

export async function maybeSummarizeChat(chatId: string): Promise<void> {
  const settings = getSettings();
  const userCount = countUserMessages(chatId);
  if (userCount === 0 || userCount % settings.summary_every_n_turns !== 0) {
    return;
  }

  const chat = getChat(chatId);
  if (!chat) return;

  const model = settings.chat_model;
  if (!model) return;

  // Fold only the messages added since the last summary into the rolling
  // summary, combined with the previous summary. This is the key fix: the
  // model now actually sees the new conversation content.
  const newMessages = listMessagesAfter(chatId, chat.last_summarized_at);
  const transcript = formatTranscript(newMessages);
  if (!transcript.trim()) return;

  const latestTimestamp =
    newMessages[newMessages.length - 1]?.created_at ?? chat.last_summarized_at;

  const client = createLmClient();
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You maintain a running summary of a conversation between a user and a document-grounded assistant. Merge the new messages into the previous summary. Preserve key facts, decisions, file references, user preferences, and open questions. Be concise: under 400 words.",
      },
      {
        role: "user",
        content: `Previous summary:\n${chat.summary || "(none)"}\n\nNew messages since the last summary:\n${transcript}\n\nProduce the updated running summary.`,
      },
    ],
    temperature: 0.2,
  });

  const summary = response.choices[0]?.message?.content?.trim();
  if (summary) {
    updateChatSummary(chatId, summary, latestTimestamp ?? undefined);
  }
}

export async function maybeGenerateTitle(
  chatId: string,
  firstUserMessage: string,
): Promise<void> {
  const chat = getChat(chatId);
  if (!chat || chat.title !== "New chat") return;

  const settings = getSettings();
  if (!settings.chat_model) {
    updateChatTitle(chatId, firstUserMessage.slice(0, 60));
    return;
  }

  try {
    const client = createLmClient();
    const response = await client.chat.completions.create({
      model: settings.chat_model,
      messages: [
        {
          role: "system",
          content: "Generate a short chat title (max 6 words) for this message.",
        },
        { role: "user", content: firstUserMessage },
      ],
      temperature: 0.3,
      max_tokens: 24,
    });
    const title = response.choices[0]?.message?.content?.trim();
    if (title) updateChatTitle(chatId, title.replaceAll('"', ""));
  } catch {
    updateChatTitle(chatId, firstUserMessage.slice(0, 60));
  }
}

export function persistAssistantMessage(
  chatId: string,
  content: string,
  toolCallsJson?: string | null,
  meta?: {
    sources_json?: string | null;
    elapsed_ms?: number | null;
    first_token_ms?: number | null;
  },
): void {
  insertMessage({
    chat_id: chatId,
    role: "assistant",
    content,
    tool_calls_json: toolCallsJson ?? null,
    tool_call_id: null,
    tool_name: null,
    sources_json: meta?.sources_json ?? null,
    elapsed_ms: meta?.elapsed_ms ?? null,
    first_token_ms: meta?.first_token_ms ?? null,
  });
}
