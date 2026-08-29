export function normalizeApiPath(
  rawPath: string | string[] | undefined,
): string {
  const parts = (
    Array.isArray(rawPath)
      ? rawPath.map(String)
      : String(rawPath || "").split("/")
  ).filter(Boolean);
  return "/" + parts.join("/");
}
