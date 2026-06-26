import type { APIRoute } from "astro";
import { checkLmStudioHealth } from "../../../lib/lmstudio/client";
import { getSettings } from "../../../lib/db/queries";
import { normalizeLmStudioBaseUrl } from "../../../lib/lmstudio/url";

export const GET: APIRoute = async ({ url }) => {
  const settings = getSettings();
  const baseUrlParam = url.searchParams.get("base_url");
  const health = await checkLmStudioHealth(
    baseUrlParam ? { baseUrl: normalizeLmStudioBaseUrl(baseUrlParam) } : undefined,
  );
  return new Response(
    JSON.stringify({
      ...health,
      settings: {
        chat_model: settings.chat_model,
        embedding_model: settings.embedding_model,
        base_url: settings.lmstudio_base_url,
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
};
