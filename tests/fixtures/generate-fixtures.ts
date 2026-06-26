/**
 * One-shot fixture generator for document conversion e2e tests.
 * Run: bun tests/fixtures/generate-fixtures.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as XLSX from "xlsx";

const dir = dirname(import.meta.path);

async function writeXlsx(): Promise<void> {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Product", "Revenue"],
    ["Widget", "BETA-99"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sales");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await writeFile(join(dir, "sample.xlsx"), buffer);
}

async function writePdf(): Promise<void> {
  const response = await fetch(
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
  );
  if (!response.ok) throw new Error(`Failed to fetch sample PDF: ${response.status}`);
  await writeFile(join(dir, "sample.pdf"), Buffer.from(await response.arrayBuffer()));
}

async function writeDocx(): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>The secret code is ALPHA-DOCX-SECRET.</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await writeFile(join(dir, "sample.docx"), buffer);
}

await mkdir(dir, { recursive: true });
await writeXlsx();
await writePdf();
await writeDocx();
console.log("Wrote tests/fixtures/sample.xlsx, sample.pdf, sample.docx");
