import type { APIRoute } from "astro";
import { getChat, listMessages } from "../../../../lib/db/queries";

export const GET: APIRoute = async ({ params }) => {
  const chat = getChat(params.id!);
  if (!chat) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }
  return new Response(JSON.stringify(listMessages(chat.id)), {
    headers: { "Content-Type": "application/json" },
  });
};
