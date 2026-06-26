import type { APIRequestContext } from "@playwright/test";
import {
  E2E_PROJECT_NAME_PREFIX,
  USER_LM_STUDIO_BASE_URL,
} from "./constants";

interface ProjectSummary {
  id: string;
  name: string;
}

export interface SavedLmStudioSettings {
  lmstudio_base_url: string;
  chat_model: string;
  embedding_model: string;
}

export async function deleteE2eProjects(
  request: APIRequestContext,
): Promise<void> {
  const response = await request.get("/api/projects");
  if (!response.ok()) {
    throw new Error(`Failed to list projects for e2e cleanup: ${response.status()}`);
  }

  const projects = (await response.json()) as ProjectSummary[];
  for (const project of projects) {
    if (!project.name.startsWith(E2E_PROJECT_NAME_PREFIX)) continue;
    const deleted = await request.delete(`/api/projects/${project.id}`);
    if (!deleted.ok() && deleted.status() !== 404) {
      throw new Error(
        `Failed to delete e2e project ${project.id}: ${deleted.status()}`,
      );
    }
  }
}

export async function restoreLmStudioSettings(
  request: APIRequestContext,
  saved: SavedLmStudioSettings | null,
): Promise<void> {
  const restore = saved ?? {
    lmstudio_base_url: USER_LM_STUDIO_BASE_URL,
    chat_model: "",
    embedding_model: "",
  };

  const response = await request.put("/api/settings", {
    data: {
      lmstudio_base_url: restore.lmstudio_base_url,
      chat_model: restore.chat_model,
      embedding_model: restore.embedding_model,
    },
  });

  if (!response.ok()) {
    throw new Error(`Failed to restore settings after e2e: ${response.status()}`);
  }
}

export async function cleanupE2eViaApi(
  request: APIRequestContext,
  savedSettings: SavedLmStudioSettings | null,
): Promise<void> {
  await deleteE2eProjects(request);
  await restoreLmStudioSettings(request, savedSettings);
}
