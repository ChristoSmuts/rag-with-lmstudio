import { useState } from "react";
import type { Message, SourceRef } from "../lib/db/types";
import { MarkdownContent } from "./MarkdownContent";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function parseSources(json: string | null): SourceRef[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as SourceRef[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4 4v5h5M20 20v-5h-5M20 8a8 8 0 0 0-14.9-3M4 16a8 8 0 0 0 14.9 3" />
    </svg>
  );
}

interface ChatMessageProps {
  message: Message;
  streaming?: boolean;
  onEdit?: (messageId: string, content: string) => void;
  onRerun?: (messageId: string) => void;
  showRefreshRerun?: boolean;
  onRefreshRerun?: () => void;
  refreshDisabled?: boolean;
  /** Live sources/timing for the message currently streaming. */
  liveSources?: SourceRef[];
  liveElapsedMs?: number | null;
  onOpenSource?: (source: SourceRef) => void;
}

export function ChatMessage({
  message,
  streaming = false,
  onEdit,
  onRerun,
  showRefreshRerun = false,
  onRefreshRerun,
  refreshDisabled = false,
  liveSources,
  liveElapsedMs,
  onOpenSource,
}: ChatMessageProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const isUser = message.role === "user";

  if (message.role === "tool") return null;

  const sources =
    liveSources && liveSources.length > 0
      ? liveSources
      : parseSources(message.sources_json);
  const elapsedMs = liveElapsedMs ?? message.elapsed_ms;
  const showMeta = !isUser && !editing;

  function saveEdit() {
    const text = draft.trim();
    if (!text || !onEdit) return;
    onEdit(message.id, text);
    setEditing(false);
  }

  return (
    <div
      className={`group rounded-xl border px-4 py-3 text-sm ${
        isUser
          ? "border-surface-700 bg-surface-900"
          : "border-surface-700/80 bg-surface-900/60"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">
          {message.role}
        </span>
        {isUser && !streaming && !editing && (
          <div className="flex gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button
              type="button"
              aria-label="Edit message"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
              className="pressable min-h-9 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-surface-800 hover:text-zinc-200"
            >
              Edit
            </button>
            <button
              type="button"
              aria-label="Rerun from this message"
              onClick={() => onRerun?.(message.id)}
              className="pressable min-h-9 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-surface-800 hover:text-zinc-200"
            >
              Rerun
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            aria-label="Edit message"
            className="field resize-y text-zinc-100"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveEdit()}
              className="btn-primary px-3 py-1 text-xs"
            >
              Save & rerun
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="btn-ghost px-3 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : isUser ? (
        <div className="whitespace-pre-wrap text-zinc-200">{message.content}</div>
      ) : (
        <MarkdownContent content={message.content} />
      )}

      {showMeta && sources.length > 0 && (
        <div className="mt-3 border-t border-surface-700/60 pt-2">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Sources
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((source) => (
              <button
                key={source.chunk_id}
                type="button"
                onClick={() => onOpenSource?.(source)}
                aria-label={`Open ${source.filename} (lines ${source.start_line}-${source.end_line})`}
                title={`Open ${source.filename} (lines ${source.start_line}-${source.end_line})`}
                className="pressable inline-flex max-w-full items-center gap-1 rounded-md border border-surface-600 bg-surface-800/60 px-2 py-1 text-xs text-zinc-300 hover:border-accent-500/50 hover:text-accent-300"
              >
                <span className="truncate">{source.filename}</span>
                <span className="shrink-0 text-zinc-500">
                  :{source.start_line}-{source.end_line}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showMeta && (elapsedMs != null || streaming) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
          {streaming ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="streaming-dot" aria-hidden="true" />
              Generating
              {elapsedMs != null ? ` · ${formatDuration(elapsedMs)}` : ""}
            </span>
          ) : (
            elapsedMs != null && (
              <span>
                {formatDuration(elapsedMs)}
                {message.first_token_ms != null
                  ? ` · first token ${formatDuration(message.first_token_ms)}`
                  : ""}
              </span>
            )
          )}
        </div>
      )}

      {showRefreshRerun && !editing && (
        <div className="mt-2 flex justify-end border-t border-surface-700/60 pt-2">
          <button
            type="button"
            aria-label="Rerun last prompt"
            disabled={refreshDisabled}
            onClick={() => onRefreshRerun?.()}
            className="icon-btn h-9 w-9 text-zinc-500 hover:text-accent-300 disabled:opacity-50"
          >
            <RefreshIcon />
          </button>
        </div>
      )}
    </div>
  );
}
