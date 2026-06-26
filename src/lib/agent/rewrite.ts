import { createLmClient } from "../lmstudio/client";
import { getSettings, listMessages } from "../db/queries";
import type { Message } from "../db/types";

const MAX_CONTEXT_CHARS = 1_500;

function recentContext(messages: Message[]): string {
  const convo = messages.filter(
    (m) =>
      m.role === "user" || (m.role === "assistant" && m.content.trim().length > 0),
  );
  // Drop the final user message (the current question) from the context.
  let lastUserIdx = -1;
  for (let i = convo.length - 1; i >= 0; i--) {
    if (convo[i]!.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const prior = lastUserIdx >= 0 ? convo.slice(0, lastUserIdx) : convo;
  const tail = prior.slice(-4);
  const text = tail
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  return text.length > MAX_CONTEXT_CHARS ? text.slice(-MAX_CONTEXT_CHARS) : text;
}

function heuristicRewrite(context: string, userMessage: string): string {
  if (!context) return userMessage;
  // Pull the most recent prior user line to anchor pronouns/ellipsis.
  const priorUser = context
    .split("\n")
    .reverse()
    .find((line) => line.startsWith("User: "));
  const priorText = priorUser ? priorUser.slice("User: ".length) : "";
  return priorText ? `${priorText} ${userMessage}`.trim() : userMessage;
}

/**
 * Condense a follow-up question into a standalone retrieval query using recent
 * conversation context. Uses a small LM call, with a heuristic fallback so it
 * never blocks retrieval if the model is slow or unavailable.
 */
export async function rewriteQuery(
  chatId: string,
  userMessage: string,
): Promise<string> {
  const settings = getSettings();
  if (!settings.enable_query_rewrite || !settings.chat_model) {
    return userMessage;
  }

  const messages = listMessages(chatId);
  const context = recentContext(messages);
  // No prior context means the question is already standalone.
  if (!context) return userMessage;

  try {
    const client = createLmClient();
    const response = await client.chat.completions.create({
      model: settings.chat_model,
      messages: [
        {
          role: "system",
          content:
            "Rewrite the user's latest message into a single standalone search query for retrieving from their documents. Resolve pronouns and references using the conversation. Output ONLY the query text, no quotes or preamble.",
        },
        {
          role: "user",
          content: `Conversation:\n${context}\n\nLatest message: ${userMessage}\n\nStandalone search query:`,
        },
      ],
      temperature: 0,
      max_tokens: 80,
    });
    const rewritten = response.choices[0]?.message?.content?.trim();
    if (rewritten && rewritten.length > 0) {
      return rewritten.replace(/^["']|["']$/g, "");
    }
  } catch {
    // fall through to heuristic
  }

  return heuristicRewrite(context, userMessage);
}
