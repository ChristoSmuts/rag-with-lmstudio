import type { APIRoute } from "astro";
import { z } from "zod";
import { getSettings, updateSettings } from "../../lib/db/queries";
import type { AppSettings } from "../../lib/db/types";

const settingsSchema = z.object({
  lmstudio_base_url: z.string().min(1).optional(),
  chat_model: z.string().optional(),
  embedding_model: z.string().optional(),
  context_window_budget: z.number().int().min(1000).max(128000).optional(),
  summary_every_n_turns: z.number().int().min(1).max(100).optional(),
  recent_turns_limit: z.number().int().min(2).max(50).optional(),
  max_tool_iterations: z.number().int().min(1).max(20).optional(),
  embedding_dimensions: z.number().int().min(64).max(4096).optional(),
  model_context_window: z.number().int().min(0).max(1000000).optional(),
  response_token_reserve: z.number().int().min(128).max(32000).optional(),
  retrieval_top_k: z.number().int().min(1).max(50).optional(),
  retrieval_candidate_pool: z.number().int().min(1).max(200).optional(),
  chunk_target_chars: z.number().int().min(200).max(16000).optional(),
  chunk_overlap: z.number().int().min(0).max(4000).optional(),
  enable_query_rewrite: z.boolean().optional(),
  auto_inject_memories: z.boolean().optional(),
});

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(getSettings()), {
    headers: { "Content-Type": "application/json" },
  });
};

export const PUT: APIRoute = async ({ request }) => {
  try {
    const body = settingsSchema.parse(await request.json());
    const updated = updateSettings(body as Partial<AppSettings>);
    return new Response(JSON.stringify(updated), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid settings";
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }
};
