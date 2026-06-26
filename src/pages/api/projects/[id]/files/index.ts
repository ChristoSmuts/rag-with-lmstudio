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
  isConvertible,
  projectFilesDir,
} from "../../../../../lib/db/paths";
import { guessMime } from "../../../../../lib/rag/chunker";
import { originalRelativePath } from "../../../../../lib/rag/convert";
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
    const convertible = isConvertible(entry.name);
    const relativePath = convertible
      ? originalRelativePath(entry.name)
      : entry.name;
    const diskPath = join(filesDir, relativePath);

    if (convertible) {
      await mkdir(join(filesDir, "originals"), { recursive: true });
    }
    await writeFile(diskPath, buffer);

    const mime = entry.type || guessMime(entry.name);
    const record = createFileRecord(
      project.id,
      entry.name,
      relativePath,
      mime,
      buffer.byteLength,
      convertible
        ? {
            original_relative_path: relativePath,
            source_mime: mime,
          }
        : undefined,
    );

    queueIndexing(record);
    results.push({
      ...record,
      index_status: convertible ? "pending" : "indexing",
    });
  }

  return new Response(JSON.stringify(results), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};
