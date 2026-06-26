import type { APIRoute } from "astro";
import { deleteChat, getChat } from "../../../../lib/db/queries";

export const DELETE: APIRoute = async ({ params }) => {
  const chat = getChat(params.id!);
  if (!chat) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  deleteChat(chat.id);
  return new Response(null, { status: 204 });
};
