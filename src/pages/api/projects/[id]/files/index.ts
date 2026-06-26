import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { APIRoute } from "astro";
import {
  createFileRecord,
  getProject,
  listFiles,
} from "../../../../../lib/db/queries";
import {
  isAllowedFile,
  projectFilesDir,
} from "../../../../../lib/db/paths";
import { queueIndexing } from "../../../../../lib/rag/indexer";

export const GET: APIRoute = async ({ params }) => {
  const project = getProject(params.id!);
  if (!project) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }
  return new Response(JSON.stringify(listFiles(project.id)), {
    headers: { "Content-Type": "application/json" },
  });
};

export const POST: APIRoute = async ({ params, request }) => {
  const project = getProject(params.id!);
  if (!project) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  const formData = await request.formData();
  const uploads = formData.getAll("files");
  if (uploads.length === 0) {
    return new Response(JSON.stringify({ error: "No files provided" }), {
      status: 400,
    });
  }

  const filesDir = projectFilesDir(project.id);
  await mkdir(filesDir, { recursive: true });

  const results = [];
  for (const entry of uploads) {
    if (!(entry instanceof File)) continue;
    if (!isAllowedFile(entry.name)) {
      results.push({ filename: entry.name, error: "Unsupported file type" });
      continue;
    }

    const buffer = Buffer.from(await entry.arrayBuffer());
    const relativePath = entry.name;
    const diskPath = join(filesDir, relativePath);
    await writeFile(diskPath, buffer);

    const record = createFileRecord(
      project.id,
      entry.name,
      relativePath,
      entry.type || "text/plain",
      buffer.byteLength,
    );

    // Index in the background so the upload returns immediately; the client
    // polls file status to observe pending -> indexing -> indexed/fts_only/error.
    queueIndexing(record);
    results.push({ ...record, index_status: "indexing" });
  }

  return new Response(JSON.stringify(results), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};
