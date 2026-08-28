let csrf = "";
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (csrf && !["GET", "HEAD"].includes(options.method || "GET"))
    headers.set("X-CSRF-Token", csrf);
  const res = await fetch("/api" + path, {
    ...options,
    headers,
    credentials: "include",
  });
  const body: any = await res
    .json()
    .catch(() => ({ error: "Resposta inválida do servidor." }));
  if (!res.ok)
    throw new Error(body.error || "Ocorreu um erro. Tente novamente.");
  if (body.csrf) csrf = body.csrf;
  return body as T;
}
export const post = <T>(p: string, b: unknown) =>
  api<T>(p, { method: "POST", body: JSON.stringify(b) });
export const patch = <T>(p: string, b: unknown) =>
  api<T>(p, { method: "PATCH", body: JSON.stringify(b) });
