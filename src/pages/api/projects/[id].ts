import type { APIRoute } from "astro";
import {
  deleteProject,
  getProject,
  updateProject,
} from "../../../lib/db/queries";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
});

export const GET: APIRoute = async ({ params }) => {
  const project = getProject(params.id!);
  if (!project) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }
  return new Response(JSON.stringify(project), {
    headers: { "Content-Type": "application/json" },
  });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const body = patchSchema.parse(await request.json());
    const updated = updateProject(params.id!, body);
    if (!updated) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }
    return new Response(JSON.stringify(updated), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  const deleted = deleteProject(params.id!);
  if (!deleted) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }
  return new Response(null, { status: 204 });
};
