import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as XLSX from "xlsx";
import {
  cleanupE2eViaApi,
  type SavedLmStudioSettings,
} from "./cleanup-e2e-projects";
import {
  E2E_LM_STUDIO_BASE_URL,
  E2E_PROJECT_NAME_PREFIX,
  USER_LM_STUDIO_BASE_URL,
} from "./constants";

let savedSettings: SavedLmStudioSettings | null = null;

function isE2eTaintedSettings(settings: SavedLmStudioSettings): boolean {
  return (
    settings.lmstudio_base_url === E2E_LM_STUDIO_BASE_URL ||
    settings.lmstudio_base_url.includes(":41234") ||
    settings.chat_model === "test-chat-model"
  );
}

test.beforeAll(async ({ request }) => {
  const response = await request.get("/api/settings");
  if (!response.ok()) return;

  const json = (await response.json()) as SavedLmStudioSettings;
  savedSettings = isE2eTaintedSettings(json)
    ? {
        lmstudio_base_url: USER_LM_STUDIO_BASE_URL,
        chat_model: "",
        embedding_model: "",
      }
    : {
        lmstudio_base_url: json.lmstudio_base_url,
        chat_model: json.chat_model,
        embedding_model: json.embedding_model,
      };
});

test.afterAll(async ({ request }) => {
  await cleanupE2eViaApi(request, savedSettings);
});

test.beforeEach(async ({ request }) => {
  await request.put("/api/settings", {
    data: {
      lmstudio_base_url: E2E_LM_STUDIO_BASE_URL,
      chat_model: "test-chat-model",
      embedding_model: "",
    },
  });
});

test("creates project, uploads file, chats, and persists after refresh", async ({
  page,
}) => {
  const projectName = `${E2E_PROJECT_NAME_PREFIX} ${Date.now()}`;
  await page.goto("/");

  await page.getByPlaceholder("Project name").fill(projectName);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(projectName).first()).toBeVisible();

  await page.locator("a[href^='/project/']", { hasText: projectName }).click();
  await expect(page.getByText("Workspace")).toBeVisible();
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached({
    timeout: 15_000,
  });

  const samplePath = join(tmpdir(), "rag-e2e-sample.md");
  await writeFile(
    samplePath,
    "# Sample Doc\n\nThe secret code is ALPHA-42.\n",
    "utf8",
  );

  await page.locator('input[type="file"]').setInputFiles(samplePath);
  await expect(page.getByText("sample.md")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByRole("button", { name: "New" }).click();

  const textarea = page.getByPlaceholder("Ask about your project files...");
  await expect(textarea).toBeEnabled({ timeout: 10_000 });
  await textarea.fill("What is the secret code?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.locator(".chat-markdown", { hasText: /Mock answer about/i }).first(),
  ).toBeVisible({
    timeout: 20_000,
  });

  await page.reload();
  await expect(
    page.locator(".whitespace-pre-wrap", { hasText: /^What is the secret code\?$/ }),
  ).toBeVisible();
  await expect(
    page.locator(".chat-markdown", { hasText: /Mock answer about/i }).first(),
  ).toBeVisible();
});

test("settings API saves LM Studio URL", async ({ request }) => {
  const response = await request.put("/api/settings", {
    data: {
      lmstudio_base_url: E2E_LM_STUDIO_BASE_URL,
      chat_model: "test-chat-model",
    },
  });
  expect(response.ok()).toBeTruthy();
  const json = await response.json();
  expect(json.chat_model).toBe("test-chat-model");
});

async function createProjectAndOpen(page: import("@playwright/test").Page) {
  const projectName = `${E2E_PROJECT_NAME_PREFIX} ${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  await page.goto("/");
  await page.getByPlaceholder("Project name").fill(projectName);
  await page.getByRole("button", { name: "Create" }).click();
  await page.locator("a[href^='/project/']", { hasText: projectName }).click();
  await expect(page.getByText("Workspace")).toBeVisible();
  // Wait for the React island to hydrate before interacting; otherwise event
  // handlers (e.g. the file <input> onChange) are not yet attached.
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached({
    timeout: 15_000,
  });
  return projectName;
}

async function uploadSample(
  page: import("@playwright/test").Page,
  body = "# Sample Doc\n\nThe secret code is ALPHA-42.\n",
) {
  const samplePath = join(tmpdir(), "rag-e2e-sample.md");
  await writeFile(samplePath, body, "utf8");
  await page.locator('input[type="file"]').setInputFiles(samplePath);
  await expect(page.getByRole("button", { name: /View rag-e2e-sample\.md/ })).toBeVisible({
    timeout: 15_000,
  });
}

test("FTS-only: cites sources, opens file viewer, shows timing + context", async ({
  page,
}) => {
  // beforeEach configures embedding_model: "" -> keyword (FTS) only.
  await createProjectAndOpen(page);
  await uploadSample(page);

  // Background indexing settles into a keyword-only badge.
  await expect(page.getByText("Keyword only").first()).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "New" }).click();
  const textarea = page.getByPlaceholder("Ask about your project files...");
  await expect(textarea).toBeEnabled({ timeout: 10_000 });
  await textarea.fill("What is the secret code?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.locator(".chat-markdown", { hasText: /Mock answer about/i }).first(),
  ).toBeVisible({ timeout: 20_000 });

  // Sources citation surfaced and clickable.
  await expect(page.getByText("Sources").first()).toBeVisible();
  const sourceChip = page
    .getByRole("button", { name: /Open rag-e2e-sample\.md/ })
    .first();
  await expect(sourceChip).toBeVisible();

  // Response timing + context-usage meter are displayed.
  await expect(page.getByText(/first token/i).first()).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Context window usage" })).toBeVisible();

  // Clicking a source opens the file viewer with the cited content.
  await sourceChip.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/ALPHA-42/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Close file viewer" }).click();
  await expect(dialog).toBeHidden();
});

test("semantic indexing: badge becomes Semantic when embeddings configured", async ({
  page,
  request,
}) => {
  await request.put("/api/settings", {
    data: {
      lmstudio_base_url: E2E_LM_STUDIO_BASE_URL,
      chat_model: "test-chat-model",
      embedding_model: "test-embed-model",
    },
  });

  await createProjectAndOpen(page);
  await uploadSample(page);

  await expect(page.getByText("Semantic").first()).toBeVisible({
    timeout: 20_000,
  });
});

test("reindex nudge upgrades keyword-only files to semantic search", async ({
  page,
  request,
}) => {
  // Upload while keyword-only.
  await createProjectAndOpen(page);
  await uploadSample(page);
  await expect(page.getByText("Keyword only").first()).toBeVisible({
    timeout: 15_000,
  });

  // Configure an embedding model, then reload so the workspace sees it.
  await request.put("/api/settings", {
    data: {
      lmstudio_base_url: E2E_LM_STUDIO_BASE_URL,
      chat_model: "test-chat-model",
      embedding_model: "test-embed-model",
    },
  });
  await page.reload();

  const nudge = page.getByRole("button", { name: /Enable semantic search/ });
  await expect(nudge).toBeVisible({ timeout: 10_000 });
  await nudge.click();

  await expect(page.getByText("Semantic").first()).toBeVisible({
    timeout: 20_000,
  });
});

test("rolling summary updates after enough turns", async ({ page, request }) => {
  await request.put("/api/settings", {
    data: {
      lmstudio_base_url: E2E_LM_STUDIO_BASE_URL,
      chat_model: "test-chat-model",
      embedding_model: "",
      summary_every_n_turns: 2,
    },
  });

  await createProjectAndOpen(page);
  const projectId = page.url().split("/project/")[1]!.split(/[/?#]/)[0]!;

  await page.getByRole("button", { name: "New" }).click();
  const textarea = page.getByPlaceholder("Ask about your project files...");
  await expect(textarea).toBeEnabled({ timeout: 10_000 });

  for (let turn = 0; turn < 2; turn++) {
    await textarea.fill(`Question number ${turn + 1} about the project`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(
      page.locator(".chat-markdown", { hasText: /Mock answer about/i }).nth(turn),
    ).toBeVisible({ timeout: 20_000 });
  }

  // The chat summary should now be populated (the summary bug fix).
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/projects/${projectId}/chats`);
        if (!res.ok()) return "";
        const chats = (await res.json()) as Array<{ summary: string }>;
        return chats[0]?.summary ?? "";
      },
      { timeout: 15_000 },
    )
    .not.toBe("");

  // Restore the default summary cadence so we don't leave altered settings.
  await request.put("/api/settings", { data: { summary_every_n_turns: 8 } });
});

test("Excel upload: converts and indexes for RAG", async ({ page }) => {
  await createProjectAndOpen(page);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Product", "Revenue"],
    ["Widget", "BETA-99"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sales");
  const xlsxPath = join(tmpdir(), "rag-e2e-sample.xlsx");
  await writeFile(
    xlsxPath,
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );

  await page.locator('input[type="file"]').setInputFiles(xlsxPath);
  await expect(
    page.getByRole("button", { name: /View rag-e2e-sample\.xlsx/ }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText("Keyword only").first()).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: /View rag-e2e-sample\.xlsx/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Converted from Excel/i)).toBeVisible();
  await expect(dialog.getByText(/BETA-99/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Close file viewer" }).click();
});

test("DOCX fixture upload: converts and shows extracted text", async ({ page }) => {
  await createProjectAndOpen(page);

  const docxPath = join(import.meta.dirname, "..", "fixtures", "sample.docx");
  await page.locator('input[type="file"]').setInputFiles(docxPath);
  await expect(
    page.getByRole("button", { name: /View sample\.docx/ }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText("Keyword only").first()).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: /View sample\.docx/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/ALPHA-DOCX-SECRET/)).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Close file viewer" }).click();
});
