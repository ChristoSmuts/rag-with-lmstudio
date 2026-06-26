import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, type FileContent } from "../lib/api";
import { MarkdownContent } from "./MarkdownContent";

interface FileViewerModalProps {
  open: boolean;
  projectId: string;
  fileId: string | null;
  /** Optional 1-based line range to highlight and scroll to (from a citation). */
  highlightStart?: number | null;
  highlightEnd?: number | null;
  onClose: () => void;
}

type ViewMode = "rendered" | "raw";

function extentionOf(filename: string): string {
  return filename.slice(filename.lastIndexOf(".")).toLowerCase();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Quote-aware CSV parser handling escaped quotes and newlines within fields. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim().length > 0);
}

export function FileViewerModal({
  open,
  projectId,
  fileId,
  highlightStart,
  highlightEnd,
  onClose,
}: FileViewerModalProps) {
  const titleId = useId();
  const [data, setData] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("rendered");
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !fileId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void api
      .getFile(projectId, fileId)
      .then((file) => {
        if (cancelled) return;
        setData(file);
        const ext = extentionOf(file.filename);
        setMode(ext === ".md" || ext === ".json" || ext === ".csv" ? "rendered" : "raw");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load file");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, fileId]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open, data]);

  useEffect(() => {
    if (!data) return;
    // Scroll the highlighted citation range into view once content renders.
    const timer = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ block: "center" });
    }, 50);
    return () => clearTimeout(timer);
  }, [data, mode]);

  const ext = data ? extentionOf(data.filename) : "";

  const csvRows = useMemo(() => {
    if (!data || ext !== ".csv" || mode !== "rendered") return null;
    try {
      return parseCsv(data.content);
    } catch {
      return null;
    }
  }, [data, ext, mode]);

  const prettyJson = useMemo(() => {
    if (!data || ext !== ".json" || mode !== "rendered") return null;
    try {
      return JSON.stringify(JSON.parse(data.content), null, 2);
    } catch {
      return null;
    }
  }, [data, ext, mode]);

  if (!open) return null;

  const canToggle = ext === ".md" || ext === ".json" || ext === ".csv";

  async function copyContent() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable
    }
  }

  function downloadContent() {
    if (!data) return;
    const blob = new Blob([data.content], { type: data.mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = data.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderLinedText(text: string) {
    const lines = text.split("\n");
    const hl = (n: number) =>
      highlightStart != null &&
      highlightEnd != null &&
      n >= highlightStart &&
      n <= highlightEnd;
    let firstHighlightSeen = false;
    return (
      <div className="overflow-x-auto rounded-lg border border-surface-700 bg-surface-950 font-mono text-xs leading-relaxed">
        {lines.map((line, i) => {
          const lineNo = i + 1;
          const highlighted = hl(lineNo);
          const attachRef = highlighted && !firstHighlightSeen;
          if (attachRef) firstHighlightSeen = true;
          return (
            <div
              key={lineNo}
              ref={attachRef ? highlightRef : undefined}
              className={`flex gap-3 px-3 ${
                highlighted ? "bg-accent-500/15" : ""
              }`}
            >
              <span className="select-none text-right text-zinc-600" style={{ minWidth: "2.5rem" }}>
                {lineNo}
              </span>
              <span className="whitespace-pre-wrap wrap-break-word text-zinc-200">
                {line || "\u00a0"}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  function renderBody() {
    if (loading) {
      return (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-surface-800"
              style={{ width: `${70 + ((i * 7) % 30)}%` }}
            />
          ))}
        </div>
      );
    }
    if (error) {
      return <p className="text-sm text-danger-500">{error}</p>;
    }
    if (!data) return null;

    if (mode === "rendered") {
      if (ext === ".md") {
        return <MarkdownContent content={data.content} />;
      }
      if (ext === ".json" && prettyJson != null) {
        return renderLinedText(prettyJson);
      }
      if (ext === ".csv" && csvRows && csvRows.length > 0) {
        const [header, ...body] = csvRows;
        return (
          <div className="overflow-x-auto rounded-lg border border-surface-700">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr>
                  {(header ?? []).map((cell, i) => (
                    <th
                      key={i}
                      className="border border-surface-700 bg-surface-800 px-2 py-1 font-medium text-zinc-200"
                    >
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((cells, r) => (
                  <tr key={r}>
                    {cells.map((cell, c) => (
                      <td
                        key={c}
                        className="border border-surface-700 px-2 py-1 text-zinc-300"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }

    return renderLinedText(data.content);
  }

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-surface-700 bg-surface-900 shadow-2xl outline-none"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-surface-700 p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold text-zinc-100">
              {data?.filename ?? "File"}
            </h2>
            {data && (
              <p className="mt-0.5 text-xs text-zinc-500">
                {formatBytes(data.size)} · {data.chunk_count} chunks · {data.index_status}
                {data.truncated ? " · preview truncated" : ""}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canToggle && data && (
              <button
                type="button"
                onClick={() => setMode((m) => (m === "rendered" ? "raw" : "rendered"))}
                className="pressable rounded-md border border-surface-600 px-2 py-1 text-xs text-zinc-300 hover:bg-surface-800"
              >
                {mode === "rendered" ? "Raw" : ext === ".csv" ? "Table" : "Rendered"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void copyContent()}
              disabled={!data}
              className="pressable rounded-md border border-surface-600 px-2 py-1 text-xs text-zinc-300 hover:bg-surface-800 disabled:opacity-50"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={downloadContent}
              disabled={!data}
              className="pressable rounded-md border border-surface-600 px-2 py-1 text-xs text-zinc-300 hover:bg-surface-800 disabled:opacity-50"
            >
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close file viewer"
              className="icon-btn h-9 w-9 text-zinc-400 hover:text-zinc-200"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 text-sm">
          {renderBody()}
        </div>
      </div>
    </div>
  );
}
