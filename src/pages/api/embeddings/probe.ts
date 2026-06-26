import type { APIRoute } from "astro";
import { z } from "zod";
import OpenAI from "openai";
import { normalizeLmStudioBaseUrl } from "../../../lib/lmstudio/url";
import { getSettings } from "../../../lib/db/queries";

const bodySchema = z.object({
  model: z.string().min(1),
  base_url: z.string().optional(),
});

export const POST: APIRoute = async ({ request }) => {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }

  const baseUrl = normalizeLmStudioBaseUrl(
    body.base_url ?? getSettings().lmstudio_base_url,
  );

  try {
    const client = new OpenAI({ baseURL: baseUrl, apiKey: "lm-studio" });
    const response = await client.embeddings.create({
      model: body.model,
      input: "dimension probe",
    });
    const dimensions = response.data[0]?.embedding.length ?? 0;
    return new Response(JSON.stringify({ dimensions }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Embedding probe failed";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
};
