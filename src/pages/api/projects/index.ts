import type { APIRoute } from "astro";
import { z } from "zod";
import { createProject, listProjects } from "../../../lib/db/queries";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(listProjects()), {
    headers: { "Content-Type": "application/json" },
  });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = createSchema.parse(await request.json());
    const project = createProject(body.name, body.description ?? "");
    return new Response(JSON.stringify(project), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }
};
