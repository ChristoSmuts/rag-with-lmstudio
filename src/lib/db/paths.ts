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

/** Extensions the AI can read and index directly. */
export const ALLOWED_EXTENSIONS = new Set([".md", ".csv", ".txt", ".json"]);

/** Extensions converted to Markdown/text before indexing. */
export const CONVERTIBLE_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".xlsx",
  ".xls",
]);

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "";
  return filename.slice(dot).toLowerCase();
}

export function isConvertible(filename: string): boolean {
  return CONVERTIBLE_EXTENSIONS.has(fileExtension(filename));
}

export function isAllowedFile(filename: string): boolean {
  const ext = fileExtension(filename);
  return ALLOWED_EXTENSIONS.has(ext) || CONVERTIBLE_EXTENSIONS.has(ext);
}
