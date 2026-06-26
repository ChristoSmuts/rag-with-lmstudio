import type { APIRoute } from "astro";
import { createChat, getProject, listChats } from "../../../../../lib/db/queries";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1).max(120).optional(),
});

export const GET: APIRoute = async ({ params }) => {
  const project = getProject(params.id!);
  if (!project) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }
  return new Response(JSON.stringify(listChats(project.id)), {
    headers: { "Content-Type": "application/json" },
  });
};

export const POST: APIRoute = async ({ params, request }) => {
  const project = getProject(params.id!);
  if (!project) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  let title = "New chat";
  try {
    const body = createSchema.parse(await request.json().catch(() => ({})));
    if (body.title) title = body.title;
  } catch {
    // use default title
  }

  const chat = createChat(project.id, title);
  return new Response(JSON.stringify(chat), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};
