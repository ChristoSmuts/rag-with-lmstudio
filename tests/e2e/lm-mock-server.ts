/**
 * Playwright e2e fixture: minimal LM Studio API stub.
 * Started by playwright.config.ts on E2E_LM_STUDIO_PORT only — not port 1234.
 */
import { createServer } from "node:http";
import { E2E_LM_STUDIO_PORT } from "./constants";

const LM_STUDIO_PORT = 1234;

const port = Number(process.env.LM_MOCK_PORT ?? E2E_LM_STUDIO_PORT);

if (port === LM_STUDIO_PORT) {
  console.error(
    `[lm-mock] Refusing port ${LM_STUDIO_PORT} — reserved for real LM Studio. Use E2E_LM_STUDIO_PORT (${E2E_LM_STUDIO_PORT}).`,
  );
  process.exit(1);
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "";

  if (url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: [{ id: "test-chat-model" }, { id: "test-embed-model" }],
      }),
    );
    return;
  }

  if (url === "/v1/embeddings" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as { input: string[] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: body.input.map((_, index) => ({
          index,
          embedding: Array.from({ length: 8 }, (_, i) => (i + index) * 0.01),
        })),
      }),
    );
    return;
  }

  if (url === "/v1/chat/completions" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      stream?: boolean;
      messages?: Array<{ role: string; content: string }>;
    };
    const lastUser = [...(body.messages ?? [])]
      .reverse()
      .find((m) => m.role === "user");
    const reply = `Mock answer about: ${lastUser?.content ?? "files"}`;

    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content: reply }, finish_reason: null }],
        })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: reply } }],
      }),
    );
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, shutdown);
}

process.stdin.on("end", shutdown);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`[lm-mock] Port ${port} is already in use.`);
  } else {
    console.error("[lm-mock] Server error:", error.message);
  }
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[lm-mock] ready on http://127.0.0.1:${port}/v1`);
});
