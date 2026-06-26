/**
 * Direct data/ cleanup for e2e artifacts. Run with Bun (not from Playwright's Node loader).
 */
import { rmSync } from "node:fs";
import { listProjects, deleteProject, getSettings, updateSettings } from "../../src/lib/db/queries";
import { projectDir } from "../../src/lib/db/paths";
import {
  E2E_LM_STUDIO_BASE_URL,
  E2E_PROJECT_NAME_PREFIX,
  USER_LM_STUDIO_BASE_URL,
} from "./constants";

export function cleanupE2eViaDb(): void {
  for (const project of listProjects()) {
    if (!project.name.startsWith(E2E_PROJECT_NAME_PREFIX)) continue;
    deleteProject(project.id);
    try {
      rmSync(projectDir(project.id), { recursive: true, force: true });
    } catch {
      // disk folder may already be gone
    }
  }

  const settings = getSettings();
  const touchedByE2e =
    settings.lmstudio_base_url === E2E_LM_STUDIO_BASE_URL ||
    settings.lmstudio_base_url.includes(":41234") ||
    settings.chat_model === "test-chat-model";

  if (touchedByE2e) {
    updateSettings({
      lmstudio_base_url: USER_LM_STUDIO_BASE_URL,
      chat_model: settings.chat_model === "test-chat-model" ? "" : settings.chat_model,
      embedding_model: "",
    });
  }
}

if (import.meta.main) {
  cleanupE2eViaDb();
}
