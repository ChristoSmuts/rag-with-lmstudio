import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { APIRoute } from "astro";
import {
  deleteChunksForFile,
  deleteFileRecord,
  getFile,
} from "../../../../../lib/db/queries";
import { projectFilesDir } from "../../../../../lib/db/paths";

// Cap returned content so the viewer never pulls an enormous payload.
const MAX_CONTENT_BYTES = 512 * 1024;

export const GET: APIRoute = async ({ params }) => {
  const file = getFile(params.fileId!);
  if (!file || file.project_id !== params.id) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  try {
    const diskPath = join(projectFilesDir(file.project_id), file.relative_path);
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

  try {
    const diskPath = join(projectFilesDir(file.project_id), file.relative_path);
    await unlink(diskPath);
  } catch {
    // file may already be gone
  }

  return new Response(null, { status: 204 });
};
