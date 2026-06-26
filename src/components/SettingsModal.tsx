import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/api";
import type { AppSettings } from "../lib/db/types";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (settings: AppSettings) => void;
}

function withSelectedModel(models: string[], selected: string): string[] {
  if (!selected || models.includes(selected)) return models;
  return [selected, ...models];
}

const EMBEDDING_HINT = /embed|bge|nomic|e5|gte|minilm|mxbai/i;
function isEmbeddingModelId(id: string): boolean {
  return EMBEDDING_HINT.test(id);
}

const URL_PROBE_DEBOUNCE_MS = 400;

function NumberField({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-zinc-400">{label}</span>
      <input
        type="number"
        className="field"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

function ToggleField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-surface-600 bg-surface-800 accent-accent-500"
      />
      {label}
    </label>
  );
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const titleId = useId();
  const statusId = useId();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [connected, setConnected] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probingDims, setProbingDims] = useState(false);
  const skipUrlDebounce = useRef(true);
  const probeGeneration = useRef(0);

  async function applyEmbeddingModel(model: string) {
    setSettings((current) => (current ? { ...current, embedding_model: model } : current));
    if (!model) return;
    setProbingDims(true);
    try {
      const { dimensions } = await api.probeEmbedding(
        model,
        settings?.lmstudio_base_url,
      );
      if (dimensions > 0) {
        setSettings((current) =>
          current ? { ...current, embedding_dimensions: dimensions } : current,
        );
      }
    } catch {
      // probe is best-effort; indexer also auto-detects on first embed
    } finally {
      setProbingDims(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setSettings(null);
      setModels([]);
      setStatus("");
      setConnected(false);
      setLoadingSettings(false);
      setLoadingModels(false);
      skipUrlDebounce.current = true;
      probeGeneration.current += 1;
      return;
    }

    let cancelled = false;
    setLoadingSettings(true);
    setStatus("Loading settings...");

    void api
      .getSettings()
      .then((saved) => {
        if (cancelled) return;
        setSettings(saved);
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : "Failed to load settings");
      })
      .finally(() => {
        if (!cancelled) setLoadingSettings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !settings) return;

    const baseUrl = settings.lmstudio_base_url;
    const generation = ++probeGeneration.current;

    const probe = () => {
      setLoadingModels(true);
      setConnected(false);
      setStatus("Connecting to LM Studio...");

      void api.getLmStudioHealth(baseUrl).then((health) => {
        if (generation !== probeGeneration.current) return;

        setModels(health.models);
        setConnected(health.ok);
        setStatus(
          health.ok
            ? `Connected · ${health.models.length} model${health.models.length === 1 ? "" : "s"} available`
            : health.error ?? "Could not reach LM Studio",
        );

        if (health.ok) {
          setSettings((current) => {
            if (!current) return current;
            const chatModel = health.models.includes(current.chat_model)
              ? current.chat_model
              : "";
            const embeddingModel = health.models.includes(current.embedding_model)
              ? current.embedding_model
              : "";
            if (
              chatModel === current.chat_model &&
              embeddingModel === current.embedding_model
            ) {
              return current;
            }
            return {
              ...current,
              chat_model: chatModel,
              embedding_model: embeddingModel,
            };
          });
        } else {
          setModels([]);
        }

        setLoadingModels(false);
      });
    };

    if (skipUrlDebounce.current) {
      skipUrlDebounce.current = false;
      probe();
      return;
    }

    const timer = setTimeout(probe, URL_PROBE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, settings?.lmstudio_base_url]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);

      const health = await api.getLmStudioHealth(updated.lmstudio_base_url);
      setModels(health.models);
      setConnected(health.ok);
      setStatus(
        health.ok
          ? "Settings saved · connected to LM Studio"
          : `Settings saved · ${health.error ?? "LM Studio unreachable"}`,
      );
      onSaved?.(updated);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const chatModels = withSelectedModel(models, settings?.chat_model ?? "");
  const embedModels = withSelectedModel(models, settings?.embedding_model ?? "");
  const modelFieldsDisabled =
    loadingSettings || loadingModels || !connected || !settings;
  const formDisabled = loadingSettings || !settings;
  const suggestedEmbedding =
    connected && settings && !settings.embedding_model
      ? models.find(isEmbeddingModelId)
      : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={statusId}
        className="w-full max-w-lg rounded-xl border border-surface-700 bg-surface-900 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-zinc-100">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="icon-btn text-zinc-400 hover:text-zinc-200"
          >
            Close
          </button>
        </div>

        <div
          id={statusId}
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-2 text-sm text-zinc-400"
        >
          {(loadingSettings || loadingModels) && (
            <span
              aria-hidden="true"
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-accent-400"
            />
          )}
          <span className={connected ? "text-accent-300" : undefined}>{status}</span>
        </div>

        {loadingSettings || !settings ? (
          <p className="text-sm text-zinc-500">Loading settings...</p>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-400">
                LM Studio URL (must end with /v1)
              </span>
              <input
                className="field"
                value={settings.lmstudio_base_url}
                disabled={formDisabled || saving}
                onChange={(e) =>
                  setSettings({ ...settings, lmstudio_base_url: e.target.value })
                }
                placeholder="http://127.0.0.1:1234/v1"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-400">Chat model</span>
              <select
                className="field disabled:cursor-not-allowed disabled:opacity-50"
                value={settings.chat_model}
                disabled={modelFieldsDisabled || saving}
                onChange={(e) =>
                  setSettings({ ...settings, chat_model: e.target.value })
                }
              >
                <option value="">
                  {loadingModels
                    ? "Loading models..."
                    : connected
                      ? "Select model"
                      : "Connect to LM Studio first"}
                </option>
                {chatModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-400">
                Embedding model (recommended for semantic search)
              </span>
              <select
                className="field disabled:cursor-not-allowed disabled:opacity-50"
                value={settings.embedding_model}
                disabled={modelFieldsDisabled || saving}
                onChange={(e) => void applyEmbeddingModel(e.target.value)}
              >
                <option value="">
                  {loadingModels
                    ? "Loading models..."
                    : connected
                      ? "Keyword (FTS) + tools only"
                      : "Connect to LM Studio first"}
                </option>
                {embedModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-zinc-500">
                {probingDims
                  ? "Detecting embedding dimensions…"
                  : settings.embedding_model
                    ? `Dimensions: ${settings.embedding_dimensions}`
                    : "Without an embedding model, retrieval falls back to keyword search."}
              </span>
            </label>

            {suggestedEmbedding && (
              <div className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-3 text-sm">
                <p className="text-zinc-300">
                  Found an embedding-capable model:{" "}
                  <span className="font-medium text-accent-300">
                    {suggestedEmbedding}
                  </span>
                  . Enable it for semantic retrieval.
                </p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void applyEmbeddingModel(suggestedEmbedding)}
                  className="pressable mt-2 rounded-md border border-accent-500/40 bg-accent-500/10 px-3 py-1.5 text-xs text-accent-300 hover:bg-accent-500/20"
                >
                  Use {suggestedEmbedding}
                </button>
              </div>
            )}

            <details className="rounded-lg border border-surface-700 bg-surface-800/40 p-3">
              <summary className="cursor-pointer text-sm font-medium text-zinc-300">
                Advanced (retrieval & context)
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Model context window"
                    hint="0 = auto-detect"
                    value={settings.model_context_window}
                    disabled={formDisabled || saving}
                    onChange={(v) =>
                      setSettings({ ...settings, model_context_window: v })
                    }
                  />
                  <NumberField
                    label="Response reserve (tokens)"
                    value={settings.response_token_reserve}
                    disabled={formDisabled || saving}
                    onChange={(v) =>
                      setSettings({ ...settings, response_token_reserve: v })
                    }
                  />
                  <NumberField
                    label="Retrieved chunks (top-k)"
                    value={settings.retrieval_top_k}
                    disabled={formDisabled || saving}
                    onChange={(v) =>
                      setSettings({ ...settings, retrieval_top_k: v })
                    }
                  />
                  <NumberField
                    label="Candidate pool"
                    value={settings.retrieval_candidate_pool}
                    disabled={formDisabled || saving}
                    onChange={(v) =>
                      setSettings({ ...settings, retrieval_candidate_pool: v })
                    }
                  />
                  <NumberField
                    label="Chunk size (chars)"
                    hint="re-index after changing"
                    value={settings.chunk_target_chars}
                    disabled={formDisabled || saving}
                    onChange={(v) =>
                      setSettings({ ...settings, chunk_target_chars: v })
                    }
                  />
                  <NumberField
                    label="Chunk overlap (chars)"
                    hint="re-index after changing"
                    value={settings.chunk_overlap}
                    disabled={formDisabled || saving}
                    onChange={(v) =>
                      setSettings({ ...settings, chunk_overlap: v })
                    }
                  />
                </div>
                <ToggleField
                  label="History-aware query rewriting"
                  checked={settings.enable_query_rewrite}
                  disabled={formDisabled || saving}
                  onChange={(v) =>
                    setSettings({ ...settings, enable_query_rewrite: v })
                  }
                />
                <ToggleField
                  label="Auto-inject relevant memories"
                  checked={settings.auto_inject_memories}
                  disabled={formDisabled || saving}
                  onChange={(v) =>
                    setSettings({ ...settings, auto_inject_memories: v })
                  }
                />
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-400">
                    Fallback context budget (tokens)
                  </span>
                  <input
                    type="number"
                    className="field"
                    value={settings.context_window_budget}
                    disabled={formDisabled || saving}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        context_window_budget: Number(e.target.value),
                      })
                    }
                  />
                  <span className="mt-1 block text-xs text-zinc-500">
                    Used only when the model context window can't be detected.
                  </span>
                </label>
              </div>
            </details>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || loadingSettings || !settings}
            onClick={() => void save()}
            className="btn-primary"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
