import type { APIRoute } from "astro";
import { getFile } from "../../../../../../lib/db/queries";
import { queueIndexing } from "../../../../../../lib/rag/indexer";

export const POST: APIRoute = async ({ params }) => {
  const file = getFile(params.fileId!);
  if (!file || file.project_id !== params.id) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  queueIndexing(file);

  return new Response(
    JSON.stringify({ ...file, index_status: "indexing", error_message: null }),
    { status: 202, headers: { "Content-Type": "application/json" } },
  );
};
