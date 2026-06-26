import { useEffect, useRef, useState } from "react";
import {
  api,
  streamChat,
  type ChatStreamMode,
  type GenerationStats,
  type StreamEvent,
} from "../lib/api";
import type { Chat, Message, ProjectFile, SourceRef } from "../lib/db/types";
import { ChatMessage } from "./ChatMessage";
import { MarkdownContent } from "./MarkdownContent";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileViewerModal } from "./FileViewerModal";
import { LmStudioStatus } from "./LmStudioStatus";
import { SettingsModal } from "./SettingsModal";

interface ProjectWorkspaceProps {
  projectId: string;
}

const PANEL_COLLAPSED = 44;
const FILES_WIDTH = 260;
const CHATS_WIDTH = 220;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface StatusBadge {
  label: string;
  className: string;
  title: string;
}

function statusBadge(status: ProjectFile["index_status"]): StatusBadge {
  switch (status) {
    case "indexed":
      return {
        label: "Semantic",
        className: "border-accent-500/40 bg-accent-500/10 text-accent-300",
        title: "Indexed with embeddings — semantic + keyword search.",
      };
    case "fts_only":
      return {
        label: "Keyword only",
        className: "border-warn-500/40 bg-warn-500/10 text-warn-500",
        title: "Indexed for keyword search only. Configure an embedding model and reindex for semantic search.",
      };
    case "indexing":
      return {
        label: "Indexing…",
        className: "border-surface-600 bg-surface-700/60 text-zinc-300",
        title: "Indexing in progress.",
      };
    case "converting":
      return {
        label: "Converting…",
        className: "border-surface-600 bg-surface-700/60 text-zinc-300",
        title: "Converting to AI-readable text before indexing.",
      };
    case "pending":
      return {
        label: "Pending",
        className: "border-surface-600 bg-surface-700/60 text-zinc-400",
        title: "Waiting to be indexed.",
      };
    case "error":
      return {
        label: "Error",
        className: "border-danger-500/40 bg-danger-500/10 text-danger-500",
        title: "Indexing failed. Try reindexing.",
      };
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function isStale(file: ProjectFile, embeddingModel: string): boolean {
  if (!embeddingModel) return false;
  if (file.index_status === "fts_only") return true;
  return (
    file.index_status === "indexed" && file.embedding_model !== embeddingModel
  );
}

function FilesIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function ChatsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 10h8M8 14h5M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3V7a2 2 0 0 1 2-2z" />
    </svg>
  );
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

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4 7h16M6 7l1 14h10l1-14M9 7V5h6v2" />
    </svg>
  );
}

type PendingConfirm =
  | { type: "file"; id: string; name: string }
  | { type: "chat"; id: string; title: string };

export function ProjectWorkspace({ projectId }: ProjectWorkspaceProps) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [toolTrace, setToolTrace] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [lmOk, setLmOk] = useState(false);
  const [filesOpen, setFilesOpen] = useState(true);
  const [chatsOpen, setChatsOpen] = useState(true);
  const [isDesktop, setIsDesktop] = useState(true);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [filesLoading, setFilesLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [viewerFileId, setViewerFileId] = useState<string | null>(null);
  const [viewerHighlight, setViewerHighlight] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [liveSources, setLiveSources] = useState<SourceRef[]>([]);
  const [stats, setStats] = useState<GenerationStats | null>(null);
  const [streamElapsed, setStreamElapsed] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const streamStartRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamGenRef = useRef(0);

  const filesCol = filesOpen ? FILES_WIDTH : PANEL_COLLAPSED;
  const chatsCol = chatsOpen ? CHATS_WIDTH : PANEL_COLLAPSED;

  async function refreshFiles() {
    try {
      setFiles(await api.listFiles(projectId));
    } finally {
      setFilesLoading(false);
    }
  }

  async function refreshSettingsSnapshot() {
    try {
      const saved = await api.getSettings();
      setEmbeddingModel(saved.embedding_model);
    } catch {
      // settings load is best-effort for the stale-file nudge
    }
  }

  async function refreshChats(selectId?: string) {
    const next = await api.listChats(projectId);
    setChats(next);
    if (selectId) setActiveChatId(selectId);
    else if (!activeChatId && next[0]) setActiveChatId(next[0].id);
  }

  async function refreshMessages(chatId: string) {
    setMessages(await api.listMessages(chatId));
  }

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    void refreshFiles();
    void refreshChats();
    void refreshLmHealth();
    void refreshSettingsSnapshot();
  }, [projectId]);

  // Poll while any file is still being indexed so status badges update live.
  useEffect(() => {
    const inFlight = files.some(
      (f) =>
        f.index_status === "pending" ||
        f.index_status === "converting" ||
        f.index_status === "indexing",
    );
    if (!inFlight) return;
    const timer = setInterval(() => {
      void refreshFiles();
    }, 1500);
    return () => clearInterval(timer);
  }, [files]);

  // Live elapsed timer while streaming a response.
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => {
      setStreamElapsed(Date.now() - streamStartRef.current);
    }, 200);
    return () => clearInterval(timer);
  }, [streaming]);

  async function refreshLmHealth() {
    const health = await api.getLmStudioHealth();
    setLmOk(health.ok);
  }

  function handleSettingsSaved() {
    setSettingsRevision((n) => n + 1);
    void refreshLmHealth();
    void refreshSettingsSnapshot();
  }

  function openSource(source: SourceRef) {
    setViewerHighlight({ start: source.start_line, end: source.end_line });
    setViewerFileId(source.file_id);
  }

  function openFile(fileId: string) {
    setViewerHighlight(null);
    setViewerFileId(fileId);
  }

  async function onReindexFile(fileId: string) {
    await api.reindexFile(projectId, fileId);
    await refreshFiles();
  }

  async function onReindexStale() {
    setReindexing(true);
    try {
      await api.reindexProject(projectId);
      await refreshFiles();
    } finally {
      setReindexing(false);
    }
  }

  useEffect(() => {
    if (activeChatId) void refreshMessages(activeChatId);
  }, [activeChatId]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    function onChange() {
      const desktop = mq.matches;
      setIsDesktop(desktop);
      if (!desktop) {
        setFilesOpen(false);
        setChatsOpen(false);
      }
    }
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [messages, streamText, toolTrace]);

  function stopStream() {
    abortRef.current?.abort();
    abortRef.current = null;
    streamGenRef.current += 1;
    setStreaming(false);
    setStreamText("");
  }

  async function runStream(
    body: { message: string; mode?: ChatStreamMode; messageId?: string },
  ) {
    if (!activeChatId) return;

    const gen = ++streamGenRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);
    setStreamText("");
    setToolTrace([]);
    setLiveSources([]);
    streamStartRef.current = Date.now();
    setStreamElapsed(0);

    const handleEvent = (event: StreamEvent) => {
      if (gen !== streamGenRef.current) return;
      switch (event.type) {
        case "token":
          setStreamText((prev) => prev + event.content);
          break;
        case "tool_call":
          setToolTrace((prev) => [
            ...prev,
            `Tool: ${event.name}(${event.args.slice(0, 120)})`,
          ]);
          break;
        case "tool_result":
          setToolTrace((prev) => [
            ...prev,
            `Result: ${event.content.slice(0, 160)}`,
          ]);
          break;
        case "sources":
          setLiveSources(event.items);
          break;
        case "error":
          setToolTrace((prev) => [...prev, `Error: ${event.message}`]);
          break;
        case "aborted":
          setStreamText("");
          break;
        case "done":
          if (event.stats) setStats(event.stats);
          break;
        default: {
          const _exhaustive: never = event;
          void _exhaustive;
        }
      }
    };

    try {
      if (body.mode === "send") {
        await refreshMessages(activeChatId);
      }
      await streamChat(activeChatId, body, handleEvent, controller.signal);
      if (gen !== streamGenRef.current) return;
      await refreshMessages(activeChatId);
      await refreshChats(activeChatId);
    } catch (error) {
      if (gen !== streamGenRef.current || controller.signal.aborted) return;
      setToolTrace((prev) => [
        ...prev,
        error instanceof Error ? error.message : "Chat failed",
      ]);
    } finally {
      if (gen === streamGenRef.current) {
        setStreamText("");
        setStreaming(false);
        abortRef.current = null;
      }
    }
  }

  async function onSend() {
    if (!activeChatId || !input.trim() || !lmOk) return;
    const text = input.trim();
    setInput("");

    if (streaming) stopStream();

    await runStream({ message: text, mode: "send" });
  }

  async function onRerun(messageId?: string) {
    if (!activeChatId || !lmOk) return;
    if (streaming) stopStream();

    const targetId =
      messageId ??
      [...messages].reverse().find((m) => m.role === "user")?.id;
    if (targetId) {
      const idx = messages.findIndex((m) => m.id === targetId);
      if (idx >= 0) {
        setMessages((prev) => prev.slice(0, idx + 1));
      }
    }

    await runStream({ message: "", mode: "rerun", messageId: targetId });
  }

  async function onEditMessage(messageId: string, content: string) {
    if (!activeChatId || !lmOk) return;
    if (streaming) stopStream();

    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx >= 0) {
      setMessages((prev) => prev.slice(0, idx));
    }

    await runStream({ message: content, mode: "edit", messageId });
  }

  async function onUpload(fileList: FileList | null) {
    if (!fileList?.length) return;
    setUploading(true);
    try {
      await api.uploadFiles(projectId, fileList);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshFiles();
    } finally {
      setUploading(false);
    }
  }

  async function onDeleteFile(fileId: string) {
    await api.deleteFile(projectId, fileId);
    await refreshFiles();
  }

  async function onDeleteChat(chatId: string) {
    const wasActive = activeChatId === chatId;
    await api.deleteChat(chatId);
    if (wasActive) {
      setActiveChatId(null);
      setMessages([]);
      stopStream();
    }
    const remaining = await api.listChats(projectId);
    setChats(remaining);
    if (wasActive && remaining[0]) {
      setActiveChatId(remaining[0].id);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingConfirm) return;
    const target = pendingConfirm;
    setPendingConfirm(null);
    if (target.type === "file") {
      await onDeleteFile(target.id);
    } else {
      await onDeleteChat(target.id);
    }
  }

  async function onNewChat() {
    const chat = await api.createChat(projectId);
    await refreshChats(chat.id);
    setMessages([]);
    stopStream();
    if (!isDesktop) setChatsOpen(false);
  }

  function closeMobilePanels() {
    setFilesOpen(false);
    setChatsOpen(false);
  }

  function toggleFilesPanel() {
    setFilesOpen((open) => {
      if (!open) setChatsOpen(false);
      return !open;
    });
  }

  function toggleChatsPanel() {
    setChatsOpen((open) => {
      if (!open) setFilesOpen(false);
      return !open;
    });
  }

  function selectChat(chatId: string) {
    setActiveChatId(chatId);
    if (!isDesktop) setChatsOpen(false);
  }

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const lastAssistantMessage = [...visibleMessages]
    .reverse()
    .find((m) => m.role === "assistant");
  const staleFiles = files.filter((file) => isStale(file, embeddingModel));
  const contextPct = stats
    ? Math.min(100, Math.round((stats.promptTokens / stats.promptBudget) * 100))
    : 0;

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-surface-700 bg-surface-900 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <a href="/" className="link-subtle shrink-0">
            Projects
          </a>
          <span className="text-zinc-600" aria-hidden="true">
            /
          </span>
          <span className="truncate text-sm font-medium text-zinc-100">Workspace</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <LmStudioStatus refreshKey={settingsRevision} />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="btn-secondary px-3 py-1.5 text-sm"
          >
            Settings
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {(filesOpen || chatsOpen) && !isDesktop && (
          <button
            type="button"
            aria-label="Close panel"
            className="panel-backdrop"
            onClick={closeMobilePanels}
          />
        )}

        <div
          className="grid h-full min-h-0 flex-1 grid-cols-1 overflow-hidden"
          style={
            isDesktop
              ? { gridTemplateColumns: `${filesCol}px ${chatsCol}px 1fr` }
              : undefined
          }
        >
          {/* Files panel */}
          <aside
            className={`flex h-full min-h-0 flex-col overflow-hidden border-r border-surface-700 bg-surface-900 ${
              filesOpen
                ? "max-lg:fixed max-lg:bottom-14 max-lg:left-0 max-lg:top-14 max-lg:z-40 max-lg:w-[min(280px,88vw)] max-lg:shadow-2xl"
                : "max-lg:hidden"
            }`}
            aria-label="Project files"
          >
          {filesOpen ? (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-surface-700 p-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Files
                </h2>
                <button
                  type="button"
                  aria-label="Collapse files panel"
                  onClick={() => setFilesOpen(false)}
                  className="icon-btn text-zinc-500 hover:text-zinc-300"
                >
                  ‹
                </button>
              </div>
              <div className="shrink-0 border-b border-surface-700 p-3">
                <button
                  type="button"
                  aria-label="Upload project files"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="pressable flex w-full min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-surface-600 px-3 py-2 text-xs text-zinc-300 hover:border-accent-500/50 hover:text-accent-300 disabled:opacity-60"
                >
                  {uploading && (
                    <span
                      aria-hidden="true"
                      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-accent-400"
                    />
                  )}
                  {uploading
                    ? "Uploading…"
                    : "Upload .md .csv .txt .json .pdf .docx .xlsx"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".md,.csv,.txt,.json,.pdf,.docx,.xlsx,.xls,text/plain,text/csv,text/markdown,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={(e) => void onUpload(e.target.files)}
                />
                {staleFiles.length > 0 && (
                  <div className="mt-3 rounded-lg border border-warn-500/30 bg-warn-500/5 p-2">
                    <p className="text-xs leading-relaxed text-zinc-300">
                      {staleFiles.length} file{staleFiles.length === 1 ? "" : "s"} can be
                      upgraded to semantic search.
                    </p>
                    <button
                      type="button"
                      disabled={reindexing}
                      onClick={() => void onReindexStale()}
                      className="pressable mt-2 w-full rounded-md border border-accent-500/40 bg-accent-500/10 px-2 py-1.5 text-xs text-accent-300 hover:bg-accent-500/20 disabled:opacity-60"
                    >
                      {reindexing
                        ? "Reindexing…"
                        : `Enable semantic search (reindex ${staleFiles.length})`}
                    </button>
                  </div>
                )}
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 text-sm">
                {filesLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <li
                      key={i}
                      className="mb-2 rounded-lg border border-surface-700 bg-surface-800/40 p-2"
                      aria-hidden="true"
                    >
                      <div className="h-4 w-3/4 animate-pulse rounded bg-surface-700" />
                      <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-surface-700/70" />
                    </li>
                  ))
                ) : (
                  <>
                    {files.map((file) => {
                      const badge = statusBadge(file.index_status);
                      const busy =
                        file.index_status === "pending" ||
                        file.index_status === "converting" ||
                        file.index_status === "indexing";
                      return (
                        <li
                          key={file.id}
                          className="group mb-2 rounded-lg border border-surface-700 bg-surface-800/60 transition-colors hover:border-surface-600"
                        >
                          <div className="flex items-start gap-1 p-2">
                            <button
                              type="button"
                              onClick={() => openFile(file.id)}
                              aria-label={`View ${file.filename}`}
                              className="pressable min-w-0 flex-1 rounded-md text-left"
                            >
                              <div className="truncate font-medium text-zinc-200 group-hover:text-accent-300">
                                {file.filename}
                              </div>
                              <div className="mt-1 text-xs text-zinc-500">
                                {formatBytes(file.size)} · {file.chunk_count} chunks
                              </div>
                              <div className="mt-1.5 flex items-center gap-1">
                                <span
                                  title={badge.title}
                                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                                >
                                  {busy && (
                                    <span
                                      aria-hidden="true"
                                      className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent"
                                    />
                                  )}
                                  {badge.label}
                                </span>
                              </div>
                              {file.error_message && (
                                <div className="mt-1 truncate text-[10px] text-danger-500" title={file.error_message}>
                                  {file.error_message}
                                </div>
                              )}
                            </button>
                            <div className="flex shrink-0 flex-col items-center">
                              {(isStale(file, embeddingModel) ||
                                file.index_status === "error") && (
                                <button
                                  type="button"
                                  aria-label={`Reindex ${file.filename}`}
                                  title="Reindex"
                                  disabled={busy}
                                  onClick={() => void onReindexFile(file.id)}
                                  className="icon-btn h-9 w-9 text-zinc-500 hover:text-accent-300 disabled:opacity-50"
                                >
                                  <RefreshIcon />
                                </button>
                              )}
                              <button
                                type="button"
                                aria-label={`Delete ${file.filename}`}
                                onClick={() =>
                                  setPendingConfirm({
                                    type: "file",
                                    id: file.id,
                                    name: file.filename,
                                  })
                                }
                                className="icon-btn h-9 w-9 text-zinc-500 hover:text-danger-500"
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                    {files.length === 0 && (
                      <li className="empty-state mx-2 my-4 p-4">
                        <p className="text-xs font-medium text-zinc-300">No files yet</p>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                          Upload markdown, CSV, text, JSON, PDF, Word, or Excel to index
                          for RAG.
                        </p>
                      </li>
                    )}
                  </>
                )}
              </ul>
            </>
          ) : (
            <div className="hidden h-full flex-col items-center py-3 lg:flex">
              <button
                type="button"
                aria-label="Expand files panel"
                onClick={() => setFilesOpen(true)}
                className="icon-btn hover:text-accent-300"
              >
                <FilesIcon />
              </button>
            </div>
          )}
        </aside>

          {/* Chats panel */}
          <aside
            className={`flex h-full min-h-0 flex-col overflow-hidden border-r border-surface-700 bg-surface-900 ${
              chatsOpen
                ? "max-lg:fixed max-lg:bottom-14 max-lg:right-0 max-lg:top-14 max-lg:z-40 max-lg:w-[min(280px,88vw)] max-lg:shadow-2xl"
                : "max-lg:hidden"
            }`}
            aria-label="Chat history"
          >
          {chatsOpen ? (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-surface-700 p-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Chats
                </h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void onNewChat()}
                    className="pressable min-h-9 rounded-md bg-surface-700 px-3 py-1 text-xs hover:bg-surface-600"
                  >
                    New
                  </button>
                  <button
                    type="button"
                    aria-label="Collapse chats panel"
                    onClick={() => setChatsOpen(false)}
                    className="icon-btn text-zinc-500 hover:text-zinc-300"
                  >
                    ‹
                  </button>
                </div>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 text-sm">
                {chats.length === 0 ? (
                  <li className="empty-state m-2 p-4">
                    <p className="text-xs font-medium text-zinc-300">No chats yet</p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                      Start a new chat to ask questions about your files.
                    </p>
                  </li>
                ) : (
                  chats.map((chat) => (
                    <li key={chat.id}>
                      <div className="flex items-stretch gap-1">
                        <button
                          type="button"
                          aria-current={activeChatId === chat.id ? "true" : undefined}
                          aria-label={`Open chat: ${chat.title}`}
                          onClick={() => selectChat(chat.id)}
                          className={`pressable min-h-11 min-w-0 flex-1 rounded-lg px-2 py-2 text-left ${
                            activeChatId === chat.id
                              ? "bg-accent-500/15 text-accent-300"
                              : "text-zinc-300 hover:bg-surface-800"
                          }`}
                        >
                          <div className="truncate font-medium">{chat.title}</div>
                          <div className="truncate text-xs text-zinc-500">
                            {new Date(chat.updated_at).toLocaleString()}
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete chat ${chat.title}`}
                          onClick={() =>
                            setPendingConfirm({
                              type: "chat",
                              id: chat.id,
                              title: chat.title,
                            })
                          }
                          className="icon-btn h-11 w-11 shrink-0 text-zinc-500 hover:text-danger-500"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </>
          ) : (
            <div className="hidden h-full flex-col items-center gap-2 py-3 lg:flex">
              <button
                type="button"
                aria-label="Expand chats panel"
                onClick={() => setChatsOpen(true)}
                className="icon-btn hover:text-accent-300"
              >
                <ChatsIcon />
              </button>
              <button
                type="button"
                aria-label="New chat"
                onClick={() => void onNewChat()}
                className="icon-btn text-xs text-zinc-500 hover:text-zinc-200"
              >
                +
              </button>
            </div>
          )}
        </aside>

        {/* Main chat */}
        <section
          id="main-content"
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-950"
          aria-busy={streaming}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {!activeChatId ? (
              <div className="empty-state mx-auto max-w-md">
                <p className="text-sm font-medium text-zinc-300">No chat selected</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                  {chats.length === 0
                    ? "Create a chat from the Chats panel, then ask questions about your uploaded files."
                    : "Pick a chat from the Chats panel to continue."}
                </p>
                {!isDesktop && (
                  <button
                    type="button"
                    onClick={toggleChatsPanel}
                    className="btn-secondary mt-4"
                  >
                    Open chats
                  </button>
                )}
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-4">
                {visibleMessages.length === 0 && !streamText && (
                  <div className="empty-state">
                    <p className="text-sm font-medium text-zinc-300">Start the conversation</p>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                      Ask about facts in your files. The assistant can search, read, and cite
                      project documents.
                    </p>
                  </div>
                )}
                {visibleMessages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    streaming={false}
                    onEdit={onEditMessage}
                    onRerun={onRerun}
                    onOpenSource={openSource}
                    showRefreshRerun={
                      message.id === lastAssistantMessage?.id && !streaming
                    }
                    onRefreshRerun={() => void onRerun()}
                    refreshDisabled={!lmOk}
                  />
                ))}
                {(streamText || streaming) && (
                  <div className="rounded-xl border border-accent-500/20 bg-surface-900 px-4 py-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-accent-300">
                      {streaming && !streamText && (
                        <span className="streaming-dot" aria-hidden="true" />
                      )}
                      <span>assistant</span>
                      {streaming && (
                        <span className="normal-case text-zinc-500">
                          generating… {(streamElapsed / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                    {streamText ? (
                      <MarkdownContent content={streamText} className="text-zinc-100" />
                    ) : (
                      <p className="text-zinc-500">Thinking…</p>
                    )}
                    {liveSources.length > 0 && (
                      <div className="mt-3 border-t border-surface-700/60 pt-2">
                        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Sources
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {liveSources.map((source) => (
                            <button
                              key={source.chunk_id}
                              type="button"
                              onClick={() => openSource(source)}
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
                  </div>
                )}
                {toolTrace.length > 0 && (
                  <details className="rounded-lg border border-surface-700 bg-surface-900 p-3 text-xs text-zinc-400">
                    <summary className="text-zinc-300">Tool activity</summary>
                    <pre className="mt-2 whitespace-pre-wrap font-mono">
                      {toolTrace.join("\n")}
                    </pre>
                  </details>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-surface-700 bg-surface-900 p-4">
            <div className="mx-auto max-w-3xl space-y-2">
              {stats && !streaming && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="shrink-0">Context</span>
                  <span
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-700"
                    role="progressbar"
                    aria-valuenow={contextPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Context window usage"
                  >
                    <span
                      className={`block h-full rounded-full ${
                        contextPct > 90 ? "bg-danger-500" : "bg-accent-500"
                      }`}
                      style={{ width: `${contextPct}%` }}
                    />
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {stats.promptTokens.toLocaleString()} /{" "}
                    {stats.promptBudget.toLocaleString()} tok
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {streaming && (
                  <>
                    <button type="button" onClick={stopStream} className="btn-danger">
                      Stop generating
                    </button>
                    <span className="text-xs text-zinc-500">
                      Send a new message to interrupt and replace the response
                    </span>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={2}
                  aria-label="Chat message"
                  placeholder={
                    lmOk
                      ? streaming
                        ? "Type to interrupt with a new message..."
                        : "Ask about your project files..."
                      : "Connect LM Studio in Settings first"
                  }
                  disabled={!activeChatId || !lmOk}
                  className="field flex-1 resize-none rounded-xl disabled:opacity-50"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!activeChatId || !lmOk || !input.trim()}
                  onClick={() => void onSend()}
                  className="btn-primary self-end rounded-xl"
                >
                  {streaming ? "Interrupt" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </section>
        </div>

        <nav
          className="flex shrink-0 border-t border-surface-700 bg-surface-900 lg:hidden"
          aria-label="Workspace panels"
        >
          <button
            type="button"
            aria-expanded={filesOpen}
            onClick={toggleFilesPanel}
            className={`pressable flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
              filesOpen ? "text-accent-300" : "text-zinc-400"
            }`}
          >
            <FilesIcon />
            Files
          </button>
          <button
            type="button"
            aria-expanded={!filesOpen && !chatsOpen}
            onClick={closeMobilePanels}
            className="pressable flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-zinc-400"
          >
            <ChatsIcon />
            Chat
          </button>
          <button
            type="button"
            aria-expanded={chatsOpen}
            onClick={toggleChatsPanel}
            className={`pressable flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
              chatsOpen ? "text-accent-300" : "text-zinc-400"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
            Chats
          </button>
        </nav>
      </div>

      <FileViewerModal
        open={viewerFileId !== null}
        projectId={projectId}
        fileId={viewerFileId}
        highlightStart={viewerHighlight?.start ?? null}
        highlightEnd={viewerHighlight?.end ?? null}
        onClose={() => {
          setViewerFileId(null);
          setViewerHighlight(null);
        }}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={handleSettingsSaved}
      />

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={
          pendingConfirm?.type === "file" ? "Delete file?" : "Delete chat?"
        }
        message={
          pendingConfirm?.type === "file"
            ? `"${pendingConfirm.name}" will be removed from this project and its index entries deleted. This cannot be undone.`
            : pendingConfirm
              ? `"${pendingConfirm.title}" and all messages in it will be permanently deleted.`
              : ""
        }
        confirmLabel="Delete"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
