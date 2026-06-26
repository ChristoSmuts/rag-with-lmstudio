export function normalizeLmStudioBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "http://127.0.0.1:1234/v1";
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}
