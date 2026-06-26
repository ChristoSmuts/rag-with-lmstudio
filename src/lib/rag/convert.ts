import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
  CONVERTIBLE_EXTENSIONS,
  fileExtension,
  isConvertible,
} from "../db/paths";

export interface ConversionResult {
  text: string;
  /** Output extension for the converted AI-readable file (always .md today). */
  ext: ".md";
}

export { isConvertible };

export function needsConversion(filename: string): boolean {
  return isConvertible(filename);
}

function assertNonEmpty(text: string, label: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      `No extractable text found in ${label}. Scanned/image-only PDFs and empty documents are not supported.`,
    );
  }
  return trimmed;
}

async function convertPdf(buffer: Buffer, filename: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text: pages } = await extractText(pdf, { mergePages: false });
  const parts = pages.map((page, i) => `## Page ${i + 1}\n\n${page.trim()}`);
  return assertNonEmpty(parts.join("\n\n---\n\n"), filename);
}

function normalizeMarkdownEscapes(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");
}

async function convertDocx(buffer: Buffer, filename: string): Promise<string> {
  try {
    const result = await mammoth.convertToMarkdown({ buffer });
    if (result.value.trim()) {
      return assertNonEmpty(normalizeMarkdownEscapes(result.value), filename);
    }
  } catch {
    // fall through to raw text extraction
  }
  const fallback = await mammoth.extractRawText({ buffer });
  return assertNonEmpty(fallback.value, filename);
}

function convertSpreadsheet(buffer: Buffer, filename: string): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sections: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet).trim();
    if (!csv) continue;
    sections.push(`## ${sheetName}\n\n${csv}`);
  }

  return assertNonEmpty(sections.join("\n\n"), filename);
}

/**
 * Convert a PDF, Word, or Excel upload into AI-readable Markdown/text.
 * Runs fully locally — no LM Studio or cloud calls.
 */
export async function convertToText(
  filename: string,
  buffer: Buffer,
): Promise<ConversionResult> {
  const ext = fileExtension(filename);
  if (!CONVERTIBLE_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported conversion type: ${ext}`);
  }

  let text: string;
  switch (ext) {
    case ".pdf":
      text = await convertPdf(buffer, filename);
      break;
    case ".docx":
      text = await convertDocx(buffer, filename);
      break;
    case ".xlsx":
    case ".xls":
      text = convertSpreadsheet(buffer, filename);
      break;
    default: {
      const _exhaustive: never = ext;
      throw new Error(`Unsupported conversion type: ${_exhaustive}`);
    }
  }

  return { text, ext: ".md" };
}

/** Relative path for the converted text file derived from the original filename. */
export function convertedRelativePath(filename: string): string {
  return `converted/${filename}.md`;
}

/** Relative path for storing an uploaded original before conversion. */
export function originalRelativePath(filename: string): string {
  return `originals/${filename}`;
}
