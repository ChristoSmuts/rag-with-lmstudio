import type { APIRoute } from "astro";
import { z } from "zod";
import type { ChatStreamMode } from "../../../../lib/agent/harness";
import { runAgentStream } from "../../../../lib/agent/harness";
import {
  getChat,
  getLastUserMessage,
  getMessage,
  insertMessage,
  truncateMessagesAfter,
  truncateMessagesFrom,
} from "../../../../lib/db/queries";

const bodySchema = z
  .object({
    message: z.string().max(50000),
    mode: z.enum(["send", "rerun", "edit"]).optional().default("send"),
    messageId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      (data.mode === "send" || data.mode === "edit") &&
      !data.message.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        message: "message is required",
        path: ["message"],
      });
    }
  });

export const POST: APIRoute = async ({ params, request }) => {
  const chat = getChat(params.id!);
  if (!chat) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }

  const mode = body.mode as ChatStreamMode;
  let userMessage = body.message;
  let userMessageId: string;

  if (mode === "send") {
    const saved = insertMessage({
      chat_id: chat.id,
      role: "user",
      content: userMessage,
      tool_calls_json: null,
      tool_call_id: null,
      tool_name: null,
    });
    userMessageId = saved.id;
  } else if (mode === "rerun") {
    const target =
      (body.messageId ? getMessage(body.messageId) : null) ??
      getLastUserMessage(chat.id);
    if (!target || target.chat_id !== chat.id || target.role !== "user") {
      return new Response(JSON.stringify({ error: "No user message to rerun" }), {
        status: 400,
      });
    }
    truncateMessagesAfter(chat.id, target.id);
    userMessage = target.content;
    userMessageId = target.id;
  } else {
    if (!body.messageId) {
      return new Response(JSON.stringify({ error: "messageId required for edit" }), {
        status: 400,
      });
    }
    const target = getMessage(body.messageId);
    if (!target || target.chat_id !== chat.id || target.role !== "user") {
      return new Response(JSON.stringify({ error: "Message not found" }), {
        status: 400,
      });
    }
    truncateMessagesFrom(chat.id, target.id);
    const saved = insertMessage({
      chat_id: chat.id,
      role: "user",
      content: userMessage,
      tool_calls_json: null,
      tool_call_id: null,
      tool_name: null,
    });
    userMessageId = saved.id;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (request.signal.aborted) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        for await (const event of runAgentStream({
          projectId: chat.project_id,
          chatId: chat.id,
          userMessage,
          userMessageId,
          mode,
          signal: request.signal,
        })) {
          if (request.signal.aborted) break;
          send(event.type, event);
          if (
            event.type === "done" ||
            event.type === "error" ||
            event.type === "aborted"
          ) {
            break;
          }
        }
      } catch (error) {
        if (!request.signal.aborted) {
          const message = error instanceof Error ? error.message : "Stream failed";
          send("error", { type: "error", message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
