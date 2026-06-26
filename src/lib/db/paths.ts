import { join } from "node:path";

export const APP_ROOT = process.cwd();
export const DATA_DIR = join(APP_ROOT, "data");
export const DB_PATH = join(DATA_DIR, "app.db");

export function projectDir(projectId: string): string {
  return join(DATA_DIR, "projects", projectId);
}

export function projectFilesDir(projectId: string): string {
  return join(projectDir(projectId), "files");
}

export const ALLOWED_EXTENSIONS = new Set([".md", ".csv", ".txt", ".json"]);

export function isAllowedFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}
