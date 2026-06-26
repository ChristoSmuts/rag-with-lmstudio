import type { APIRoute } from "astro";
import {
  getProject,
  getSettings,
  listFiles,
  listStaleFiles,
} from "../../../../lib/db/queries";
import { queueIndexing } from "../../../../lib/rag/indexer";

export const POST: APIRoute = async ({ params }) => {
  const project = getProject(params.id!);
  if (!project) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  const settings = getSettings();
  // When an embedding model is configured, only refresh stale/keyword-only
  // files (upgrade them to semantic search). Otherwise reindex everything.
  const targets = settings.embedding_model
    ? listStaleFiles(project.id, settings.embedding_model)
    : listFiles(project.id);

  for (const file of targets) {
    queueIndexing(file);
  }

  return new Response(JSON.stringify({ reindexed: targets.length }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
};
