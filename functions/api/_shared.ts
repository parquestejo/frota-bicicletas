
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  COOKIE_SECURE?: string;
  BOOTSTRAP_TOKEN?: string;
}
export type Ctx = { env: Env; user?: any; session?: any; csrf?: string };
export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
export const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders,
      ...headers,
    },
  });
export const err = (message: string, status = 400) => json({ error: message }, status);
export const b64 = (a: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(a)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const random = (n = 32) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64(a.buffer);
};
export async function digest(s: string) {
  return b64(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
  );
}
export async function passwordHash(
  password: string,
  salt = random(16),
  iterations=100000,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations,
    },
    key,
    256,
  );
  return `pbkdf2_sha256$${iterations}$${salt}$${b64(bits)}`;
}
export async function passwordOK(password: string, encoded: string) {
  const [alg, it, salt] = encoded.split("$");
  if (alg !== "pbkdf2_sha256") return false;
  const actual = await passwordHash(password, salt, Number(it));
  const a = new TextEncoder().encode(actual),
    b = new TextEncoder().encode(encoded);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export class DbError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail: string,
  ) {
    super(`supabase_${status}_${code}`);
  }
}
export async function db(ctx: Ctx, path: string, init: RequestInit = {}) {
  const key = ctx.env.SUPABASE_SERVICE_ROLE_KEY || ctx.env.SUPABASE_SECRET_KEY;
  if (!ctx.env.SUPABASE_URL) throw new DbError(0, "missing_url", "");
  if (!key) throw new DbError(0, "missing_key", "");
  const h = new Headers(init.headers);
  h.set("apikey", key);
  if (key.startsWith("eyJ")) h.set("Authorization", "Bearer " + key);
  h.set("Content-Type", "application/json");
  h.set("Prefer", h.get("Prefer") || "return=representation");
  const base = ctx.env.SUPABASE_URL.replace(/\/+$/, "");
  const r = await fetch(base + "/rest/v1/" + path, { ...init, headers: h });
  const text = await r.text();
  if (!r.ok) {
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {}
    throw new DbError(
      r.status,
      String(parsed.code || "http_error"),
      String(parsed.message || text).slice(0, 300),
    );
  }
  return text ? JSON.parse(text) : null;
}
export async function dbAll(ctx: Ctx, path: string) {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const page = await db(ctx, path, {
      headers: { Range: `${from}-${from + pageSize - 1}` },
    });
    if (!Array.isArray(page)) return page;
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
export async function dbCount(ctx: Ctx, path: string) {
  const key = ctx.env.SUPABASE_SERVICE_ROLE_KEY || ctx.env.SUPABASE_SECRET_KEY;
  if (!ctx.env.SUPABASE_URL) throw new DbError(0, "missing_url", "");
  if (!key) throw new DbError(0, "missing_key", "");
  const headers = new Headers({ apikey: key, Prefer: "count=exact", Range: "0-0" });
  if (key.startsWith("eyJ")) headers.set("Authorization", "Bearer " + key);
  const base = ctx.env.SUPABASE_URL.replace(/\/+$/, "");
  const response = await fetch(base + "/rest/v1/" + path, { headers });
  if (!response.ok)
    throw new DbError(response.status, "count_error", await response.text());
  const range = response.headers.get("content-range") || "*/0";
  return Number(range.split("/").pop() || 0);
}
export function storageHeaders(ctx: Ctx) {
  const key = ctx.env.SUPABASE_SERVICE_ROLE_KEY || ctx.env.SUPABASE_SECRET_KEY;
  if (!ctx.env.SUPABASE_URL) throw new DbError(0, "missing_url", "");
  if (!key) throw new DbError(0, "missing_key", "");
  const headers = new Headers({ apikey: key });
  // As chaves modernas sb_secret não são JWT e não podem ser enviadas como
  // Bearer. A chave service_role antiga continua a precisar deste cabeçalho.
  if (key.startsWith("eyJ")) headers.set("Authorization", "Bearer " + key);
  return headers;
}
export async function uploadReceipt(
  ctx: Ctx,
  path: string,
  dataUrl: string,
  mime: string,
) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return err("O ficheiro do talão é inválido.");
  const contentType = mime || match[1],
    allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowed.includes(contentType))
    return err(
      "O talão deve ser uma imagem JPG, PNG, WebP ou um ficheiro PDF.",
    );
  const binary = atob(match[2]),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength > 5242880) return err("O talão não pode exceder 5 MB.");
  const headers = storageHeaders(ctx);
  headers.set("Content-Type", contentType);
  headers.set("x-upsert", "true");
  const base = ctx.env.SUPABASE_URL.replace(/\/+$/, "");
  const response = await fetch(
    base + "/storage/v1/object/daily-closure-receipts/" + path,
    { method: "POST", headers, body: bytes },
  );
  if (!response.ok)
    throw new DbError(response.status, "storage_upload", await response.text());
  return null;
}
export async function readReceipt(ctx: Ctx, path: string) {
  const base = ctx.env.SUPABASE_URL.replace(/\/+$/, "");
  const response = await fetch(
    base + "/storage/v1/object/daily-closure-receipts/" + path,
    { headers: storageHeaders(ctx) },
  );
  if (!response.ok)
    throw new DbError(response.status, "storage_read", await response.text());
  return response;
}
export const q = (s: string) => encodeURIComponent(s);
export function cookie(req: Request, name: string) {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1);
}
export function setCookie(ctx: Ctx, token: string, maxAge = 8 * 3600) {
  return `pt_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${ctx.env.COOKIE_SECURE === "false" ? "" : "; Secure"}`;
}
export async function body(req: Request) {
  try {
    return (await req.json()) as any;
  } catch {
    return {};
  }
}
export async function audit(
  ctx: Ctx,
  action: string,
  entity: string,
  entityId?: string,
  oldValue?: unknown,
  newValue?: unknown,
  note?: string,
) {
  await db(ctx, "audit_log", {
    method: "POST",
    body: JSON.stringify({
      user_id: ctx.user?.id,
      action,
      entity,
      entity_id: entityId,
      old_value: oldValue,
      new_value: newValue,
      note,
    }),
  });
}
export async function auth(ctx: Ctx, req: Request) {
  const token = cookie(req, "pt_session");
  if (!token) return false;
  const hash = await digest(token);
  const rows = await db(
    ctx,
    `sessions?token_hash=eq.${q(hash)}&revoked_at=is.null&expires_at=gt.${q(new Date().toISOString())}&select=*,users(*)`,
  );
  if (!rows?.[0]?.users?.active) return false;
  ctx.session = rows[0];
  ctx.user = rows[0].users;
  ctx.csrf = rows[0].csrf_token;
  return true;
}
export function allow(ctx: Ctx, role?: string) {
  return !!ctx.user && (!role || ctx.user.role === role);
}
export function csrfOK(ctx: Ctx, req: Request) {
  return (
    ["GET", "HEAD"].includes(req.method) ||
    req.headers.get("X-CSRF-Token") === ctx.csrf
  );
}
export const cleanUser = (u: any) => ({
  id: u.id,
  full_name: u.full_name,
  username: u.username,
  role: u.role,
  usual_kiosk_id: u.usual_kiosk_id,
  active: u.active,
  last_login_at: u.last_login_at,
  created_at: u.created_at,
});
