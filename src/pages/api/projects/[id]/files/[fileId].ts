import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { APIRoute } from "astro";
import {
  deleteChunksForFile,
  deleteFileRecord,
  getFile,
} from "../../../../../lib/db/queries";
import { projectFilesDir } from "../../../../../lib/db/paths";

const MAX_CONTENT_BYTES = 512 * 1024;

function contentTypeForFilename(filename: string, fallback: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    default:
      return fallback || "application/octet-stream";
  }
}

export const GET: APIRoute = async ({ params, url }) => {
  const file = getFile(params.fileId!);
  if (!file || file.project_id !== params.id) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  const downloadOriginal = url.searchParams.get("download") === "original";

  try {
    const filesDir = projectFilesDir(file.project_id);

    if (downloadOriginal) {
      if (!file.original_relative_path) {
        return new Response(JSON.stringify({ error: "No original file" }), {
          status: 404,
        });
      }
      const originalPath = join(filesDir, file.original_relative_path);
      const bytes = await readFile(originalPath);
      const mime =
        file.source_mime ?? contentTypeForFilename(file.filename, "application/octet-stream");
      return new Response(bytes, {
        headers: {
          "Content-Type": mime,
          "Content-Disposition": `attachment; filename="${file.filename}"`,
        },
      });
    }

    const diskPath = join(filesDir, file.relative_path);
    const raw = await readFile(diskPath, "utf8");
    const truncated = Buffer.byteLength(raw, "utf8") > MAX_CONTENT_BYTES;
    const content = truncated ? raw.slice(0, MAX_CONTENT_BYTES) : raw;

    return new Response(JSON.stringify({ ...file, content, truncated }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "File content unavailable" }),
      { status: 404 },
    );
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  const file = getFile(params.fileId!);
  if (!file || file.project_id !== params.id) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  deleteChunksForFile(file.id);
  deleteFileRecord(file.id);

  const filesDir = projectFilesDir(file.project_id);
  const pathsToDelete = new Set<string>();
  pathsToDelete.add(join(filesDir, file.relative_path));
  if (file.original_relative_path) {
    pathsToDelete.add(join(filesDir, file.original_relative_path));
  }

  for (const diskPath of pathsToDelete) {
    try {
      await unlink(diskPath);
    } catch {
      // file may already be gone
    }
  }

  return new Response(null, { status: 204 });
};
