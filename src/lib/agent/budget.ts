import { detectModelContextWindow } from "../lmstudio/client";
import type { AppSettings } from "../db/types";

// Headroom kept free beyond the response reserve to absorb token-estimation
// error (we estimate chars/4) and chat-template overhead.
const SAFETY_MARGIN_TOKENS = 256;

/**
 * Resolve the model's total context window in tokens: explicit setting first,
 * then LM Studio auto-detection, then a manual-budget-derived fallback.
 */
export async function resolveContextWindow(
  settings: AppSettings,
): Promise<number> {
  if (settings.model_context_window > 0) return settings.model_context_window;

  const detected = await detectModelContextWindow(settings.chat_model, settings);
  if (detected > 0) return detected;

  // Unknown window: keep prior behaviour where context_window_budget governed
  // the prompt size, leaving room for the response reserve on top.
  return settings.context_window_budget + settings.response_token_reserve;
}

/** Tokens available for the prompt after reserving space for the response. */
export function computePromptBudget(
  contextWindow: number,
  settings: AppSettings,
): number {
  const budget =
    contextWindow - settings.response_token_reserve - SAFETY_MARGIN_TOKENS;
  return Math.max(budget, 512);
}
