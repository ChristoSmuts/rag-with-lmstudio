import { getSettings } from "../db/queries";

export interface TextChunk {
  content: string;
  startLine: number;
  endLine: number;
}

export interface ChunkConfig {
  targetChars: number;
  overlap: number;
}

const DEFAULT_TARGET_CHARS = 1400;
const DEFAULT_OVERLAP_CHARS = 200;

function resolveConfig(config?: Partial<ChunkConfig>): ChunkConfig {
  const settings = getSettings();
  const targetChars = config?.targetChars ?? settings.chunk_target_chars ?? DEFAULT_TARGET_CHARS;
  const overlap = config?.overlap ?? settings.chunk_overlap ?? DEFAULT_OVERLAP_CHARS;
  return {
    targetChars: Math.max(targetChars, 200),
    // Overlap must stay below target to guarantee forward progress.
    overlap: Math.min(Math.max(overlap, 0), Math.floor(targetChars / 2)),
  };
}

function estimateLines(text: string, startIndex: number, endIndex: number): {
  startLine: number;
  endLine: number;
} {
  const prefix = text.slice(0, startIndex);
  const segment = text.slice(startIndex, endIndex);
  const startLine = prefix.split("\n").length;
  const endLine = startLine + Math.max(segment.split("\n").length - 1, 0);
  return { startLine, endLine };
}

function slidingWindows(text: string, config: ChunkConfig): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + config.targetChars, text.length);
    const content = text.slice(start, end).trim();
    if (content) {
      const lines = estimateLines(text, start, end);
      chunks.push({ content, ...lines });
    }
    if (end >= text.length) break;
    start = Math.max(end - config.overlap, start + 1);
  }
  return chunks;
}

function chunkMarkdown(text: string, config: ChunkConfig): TextChunk[] {
  const sections = text.split(/(?=^#{1,3}\s)/m).filter(Boolean);
  if (sections.length <= 1) return slidingWindows(text, config);

  const chunks: TextChunk[] = [];
  for (const section of sections) {
    if (section.length <= config.targetChars) {
      const start = text.indexOf(section);
      const lines = estimateLines(text, start, start + section.length);
      chunks.push({ content: section.trim(), ...lines });
    } else {
      chunks.push(...slidingWindows(section, config));
    }
  }
  return chunks;
}

function chunkCsv(text: string, config: ChunkConfig): TextChunk[] {
  const lines = text.split("\n");
  const header = lines[0] ?? "";
  // Scale CSV batch size with the chunk budget so rows-per-chunk tracks settings.
  const batchSize = Math.max(10, Math.floor(config.targetChars / 64));
  const chunks: TextChunk[] = [];

  for (let i = 1; i < lines.length; i += batchSize) {
    const batch = lines.slice(i, i + batchSize);
    const content = [header, ...batch].join("\n").trim();
    if (!content) continue;
    chunks.push({
      content,
      startLine: i,
      endLine: Math.min(i + batch.length, lines.length - 1),
    });
  }

  return chunks.length > 0 ? chunks : slidingWindows(text, config);
}

function chunkJson(text: string, config: ChunkConfig): TextChunk[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    const pretty = JSON.stringify(parsed, null, 2);
    return slidingWindows(pretty, config);
  } catch {
    return slidingWindows(text, config);
  }
}

export function chunkFileContent(
  filename: string,
  content: string,
  config?: Partial<ChunkConfig>,
): TextChunk[] {
  const resolved = resolveConfig(config);
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".md":
      return chunkMarkdown(content, resolved);
    case ".csv":
      return chunkCsv(content, resolved);
    case ".json":
      return chunkJson(content, resolved);
    case ".txt":
    default:
      return slidingWindows(content, resolved);
  }
}

export function guessMime(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".md":
      return "text/markdown";
    case ".csv":
      return "text/csv";
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain";
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    default:
      return "application/octet-stream";
  }
}
