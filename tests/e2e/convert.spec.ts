import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { convertToText } from "../../src/lib/rag/convert";

const fixturesDir = join(import.meta.dirname, "..", "fixtures");

test.describe("document conversion", () => {
  test("converts sample PDF to text", async () => {
    const buffer = await readFile(join(fixturesDir, "sample.pdf"));
    const { text } = await convertToText("sample.pdf", buffer);
    expect(text.toLowerCase()).toContain("dummy");
  });

  test("converts sample DOCX to text", async () => {
    const buffer = await readFile(join(fixturesDir, "sample.docx"));
    const { text } = await convertToText("sample.docx", buffer);
    expect(text).toContain("ALPHA-DOCX-SECRET");
  });

  test("converts sample XLSX to markdown", async () => {
    const buffer = await readFile(join(fixturesDir, "sample.xlsx"));
    const { text } = await convertToText("sample.xlsx", buffer);
    expect(text).toContain("BETA-99");
    expect(text).toContain("Sales");
  });
});
