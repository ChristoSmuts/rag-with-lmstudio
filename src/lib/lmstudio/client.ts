import OpenAI from "openai";
import { getSettings } from "../db/queries";
import type { AppSettings } from "../db/types";
import { normalizeLmStudioBaseUrl } from "./url";

export function createLmClient(settings?: AppSettings): OpenAI {
  const resolved = settings ?? getSettings();
  return new OpenAI({
    baseURL: normalizeLmStudioBaseUrl(resolved.lmstudio_base_url),
    apiKey: "lm-studio",
  });
}

export async function listModels(settings?: AppSettings): Promise<string[]> {
  const client = createLmClient(settings);
  const response = await client.models.list();
  return response.data.map((model) => model.id);
}

interface LmStudioNativeModel {
  id: string;
  max_context_length?: number;
  loaded_context_length?: number;
  state?: string;
}

// Cache detected context windows briefly to avoid an extra fetch per turn.
const contextWindowCache = new Map<string, { value: number; at: number }>();
const CONTEXT_CACHE_TTL_MS = 30_000;

/** Strip the trailing /v1 to reach LM Studio's native REST API root. */
function nativeApiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "");
}

/**
 * Detect the loaded context window (tokens) for a model via LM Studio's native
 * `/api/v0/models` endpoint. Returns 0 when unavailable so callers can fall
 * back to a manual setting.
 */
export async function detectModelContextWindow(
  modelId: string,
  settings?: AppSettings,
): Promise<number> {
  if (!modelId) return 0;
  const resolved = settings ?? getSettings();
  const baseUrl = normalizeLmStudioBaseUrl(resolved.lmstudio_base_url);

  const cached = contextWindowCache.get(`${baseUrl}::${modelId}`);
  if (cached && Date.now() - cached.at < CONTEXT_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const response = await fetch(`${nativeApiRoot(baseUrl)}/api/v0/models`);
    if (!response.ok) return 0;
    const body = (await response.json()) as { data?: LmStudioNativeModel[] };
    const model = body.data?.find((m) => m.id === modelId);
    const value = model?.loaded_context_length ?? model?.max_context_length ?? 0;
    contextWindowCache.set(`${baseUrl}::${modelId}`, {
      value,
      at: Date.now(),
    });
    return value;
  } catch {
    return 0;
  }
}

export async function checkLmStudioHealth(options?: {
  baseUrl?: string;
}): Promise<{
  ok: boolean;
  models: string[];
  error?: string;
}> {
  const settings = options?.baseUrl
    ? {
        ...getSettings(),
        lmstudio_base_url: normalizeLmStudioBaseUrl(options.baseUrl),
      }
    : undefined;
  try {
    const models = await listModels(settings);
    return { ok: true, models };
  } catch (error) {
    return {
      ok: false,
      models: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function embedTexts(
  texts: string[],
  model?: string,
): Promise<Float32Array[]> {
  const settings = getSettings();
  const embeddingModel = model ?? settings.embedding_model;
  if (!embeddingModel) {
    throw new Error("No embedding model configured");
  }

  const client = createLmClient();
  const inputs = texts.map((text) => text.replaceAll("\n", " "));
  const response = await client.embeddings.create({
    model: embeddingModel,
    input: inputs,
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => new Float32Array(item.embedding));
}

export async function embedQuery(text: string): Promise<Float32Array | null> {
  const settings = getSettings();
  if (!settings.embedding_model) return null;
  const [embedding] = await embedTexts([text]);
  return embedding ?? null;
}
