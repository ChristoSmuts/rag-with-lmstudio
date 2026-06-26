import type {
  AppSettings,
  Chat,
  Message,
  Project,
  ProjectFile,
  SourceRef,
} from "../lib/db/types";

export interface FileContent extends ProjectFile {
  content: string;
  truncated: boolean;
}

export interface GenerationStats {
  elapsedMs: number;
  firstTokenMs: number | null;
  tokens: number;
  tokensPerSecond: number;
  promptTokens: number;
  promptBudget: number;
  contextWindow: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Request failed: ${response.status}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  getSettings: () => request<AppSettings>("/api/settings"),
  updateSettings: (settings: Partial<AppSettings>) =>
    request<AppSettings>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }),
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (name: string, description?: string) =>
    request<Project>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    }),
  deleteProject: (id: string) =>
    request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  listFiles: (projectId: string) =>
    request<ProjectFile[]>(`/api/projects/${projectId}/files`),
  uploadFiles: async (projectId: string, files: FileList | File[]) => {
    const formData = new FormData();
    for (const file of files) formData.append("files", file);
    const response = await fetch(`/api/projects/${projectId}/files`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) throw new Error("Upload failed");
    return response.json() as Promise<ProjectFile[]>;
  },
  getFile: (projectId: string, fileId: string) =>
    request<FileContent>(`/api/projects/${projectId}/files/${fileId}`),
  deleteFile: (projectId: string, fileId: string) =>
    request<void>(`/api/projects/${projectId}/files/${fileId}`, {
      method: "DELETE",
    }),
  reindexFile: (projectId: string, fileId: string) =>
    request<ProjectFile>(`/api/projects/${projectId}/files/${fileId}/reindex`, {
      method: "POST",
    }),
  reindexProject: (projectId: string) =>
    request<{ reindexed: number }>(`/api/projects/${projectId}/reindex`, {
      method: "POST",
    }),
  probeEmbedding: (model: string, baseUrl?: string) =>
    request<{ dimensions: number }>(`/api/embeddings/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, base_url: baseUrl }),
    }),
  listChats: (projectId: string) =>
    request<Chat[]>(`/api/projects/${projectId}/chats`),
  createChat: (projectId: string, title?: string) =>
    request<Chat>(`/api/projects/${projectId}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  deleteChat: (chatId: string) =>
    request<void>(`/api/chats/${chatId}`, { method: "DELETE" }),
  listMessages: (chatId: string) =>
    request<Message[]>(`/api/chats/${chatId}/messages`),
  getLmStudioHealth: (baseUrl?: string) => {
    const query = baseUrl
      ? `?base_url=${encodeURIComponent(baseUrl)}`
      : "";
    return request<{
      ok: boolean;
      models: string[];
      error?: string;
      settings: {
        chat_model: string;
        embedding_model: string;
        base_url: string;
      };
    }>(`/api/health/lmstudio${query}`);
  },
};

export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "tool_result"; name: string; content: string }
  | { type: "sources"; items: SourceRef[] }
  | { type: "done"; messageId: string; stats?: GenerationStats }
  | { type: "aborted"; messageId: string }
  | { type: "error"; message: string };

export type ChatStreamMode = "send" | "rerun" | "edit";

export interface ChatStreamRequest {
  message: string;
  mode?: ChatStreamMode;
  messageId?: string;
}

export async function streamChat(
  chatId: string,
  body: ChatStreamRequest,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/chats/${chatId}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error("Failed to start chat stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const lines = part.split("\n");
        const dataLine = lines.find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const data = JSON.parse(dataLine.slice(6)) as StreamEvent;
        onEvent(data);
      }
    }
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  }
}
