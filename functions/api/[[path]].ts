interface Env {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SESSION_SECRET: string;
  APP_ORIGIN: string;
  COOKIE_SECURE?: string;
  BOOTSTRAP_TOKEN?: string;
}
type Ctx = { env: Env; user?: any; session?: any; csrf?: string };
const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
const err = (message: string, status = 400) => json({ error: message }, status);
const b64 = (a: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(a)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const random = (n = 32) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64(a.buffer);
};
async function digest(s: string) {
  return b64(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
  );
}
async function passwordHash(
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
async function passwordOK(password: string, encoded: string) {
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
class DbError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail: string,
  ) {
    super(`supabase_${status}_${code}`);
  }
}
async function db(ctx: Ctx, path: string, init: RequestInit = {}) {
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
function storageHeaders(ctx: Ctx) {
  const key = ctx.env.SUPABASE_SERVICE_ROLE_KEY || ctx.env.SUPABASE_SECRET_KEY;
  if (!ctx.env.SUPABASE_URL) throw new DbError(0, "missing_url", "");
  if (!key) throw new DbError(0, "missing_key", "");
  const headers = new Headers({ apikey: key, Authorization: "Bearer " + key });
  return headers;
}
async function uploadReceipt(
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
async function readReceipt(ctx: Ctx, path: string) {
  const base = ctx.env.SUPABASE_URL.replace(/\/+$/, "");
  const response = await fetch(
    base + "/storage/v1/object/daily-closure-receipts/" + path,
    { headers: storageHeaders(ctx) },
  );
  if (!response.ok)
    throw new DbError(response.status, "storage_read", await response.text());
  return response;
}
const q = (s: string) => encodeURIComponent(s);
function cookie(req: Request, name: string) {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1);
}
function setCookie(ctx: Ctx, token: string, maxAge = 8 * 3600) {
  return `pt_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${ctx.env.COOKIE_SECURE === "false" ? "" : "; Secure"}`;
}
async function body(req: Request) {
  try {
    return (await req.json()) as any;
  } catch {
    return {};
  }
}
async function audit(
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
async function auth(ctx: Ctx, req: Request) {
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
function allow(ctx: Ctx, role?: string) {
  return !!ctx.user && (!role || ctx.user.role === role);
}
function csrfOK(ctx: Ctx, req: Request) {
  return (
    ["GET", "HEAD"].includes(req.method) ||
    req.headers.get("X-CSRF-Token") === ctx.csrf
  );
}
const cleanUser = (u: any) => ({
  id: u.id,
  full_name: u.full_name,
  username: u.username,
  role: u.role,
  usual_kiosk_id: u.usual_kiosk_id,
  active: u.active,
  last_login_at: u.last_login_at,
  created_at: u.created_at,
});

export const onRequest: PagesFunction<Env> = async ({
  request,
  env,
  params,
}) => {
  const ctx: Ctx = { env };
  const rawPath = params.path;
  const parts = (
    Array.isArray(rawPath)
      ? rawPath.map(String)
      : String(rawPath || "").split("/")
  ).filter(Boolean);
  const route = "/" + parts.join("/");
  try {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204 });
    if (route === "/version" && request.method === "GET")
      return json({
        version: "1.5.0",
        routing: "array-safe",
        database_errors: "detailed",
      });
    if (route === "/bootstrap" && request.method === "POST") {
      if (
        !env.BOOTSTRAP_TOKEN ||
        request.headers.get("X-Bootstrap-Token") !== env.BOOTSTRAP_TOKEN
      )
        return err("Configuração inicial não autorizada.", 403);
      const existing = await db(ctx, "users?select=id&limit=1");
      if (existing.length)
        return err("A configuração inicial já foi concluída.", 409);
      const b = await body(request);
      if (!b.username || !b.full_name || String(b.password || "").length < 6)
        return err(
          "Preencha o nome, utilizador e uma palavra-passe com pelo menos 6 caracteres.",
        );
      await db(ctx, "users", {
        method: "POST",
        body: JSON.stringify({
          full_name: b.full_name,
          username: String(b.username).toLowerCase(),
          password_hash: await passwordHash(b.password),
          role: "admin",
        }),
      });
      return json({ ok: true });
    }
    if (route === "/auth/login" && request.method === "POST") {
      const b = await body(request),
        username = String(b.username || "")
          .trim()
          .toLowerCase(),
        ip = request.headers.get("CF-Connecting-IP") || "local",
        key = await digest(ip + ":" + username),
        since = new Date(Date.now() - 15 * 60000).toISOString();
      const attempts = await db(
        ctx,
        `login_attempts?attempt_key=eq.${q(key)}&created_at=gt.${q(since)}&success=eq.false&select=id`,
      );
      if (attempts.length >= 5)
        return err("Demasiadas tentativas. Aguarde 15 minutos.", 429);
      const users = await db(ctx, `users?username=eq.${q(username)}&select=*`),
        u = users[0];
      const ok =
        !!u &&
        u.active &&
        (await passwordOK(String(b.password || ""), u.password_hash));
      await db(ctx, "login_attempts", {
        method: "POST",
        body: JSON.stringify({ attempt_key: key, success: ok }),
      });
      if (!ok)
        return err("Nome de utilizador ou palavra-passe incorretos.", 401);
      const token = random(),
        csrfToken = random(24),
        tokenHash = await digest(token);
      await db(ctx, "sessions", {
        method: "POST",
        body: JSON.stringify({
          user_id: u.id,
          token_hash: tokenHash,
          csrf_token: csrfToken,
          expires_at: new Date(Date.now() + 8 * 3600000).toISOString(),
        }),
      });
      await db(ctx, `users?id=eq.${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ last_login_at: new Date().toISOString() }),
      });
      return json({ user: cleanUser(u), csrf: csrfToken }, 200, {
        "Set-Cookie": setCookie(ctx, token),
      });
    }
    if (!(await auth(ctx, request)))
      return err("A sessão terminou. Volte a iniciar sessão.", 401);
    if (!csrfOK(ctx, request))
      return err("Pedido inválido. Atualize a página e tente novamente.", 403);
    if (route === "/auth/me" && request.method === "GET")
      return json({ user: cleanUser(ctx.user), csrf: ctx.csrf });
    if (route === "/auth/logout" && request.method === "POST") {
      await db(ctx, `sessions?id=eq.${ctx.session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      });
      return json({ ok: true }, 200, { "Set-Cookie": setCookie(ctx, "", 0) });
    }
    if (route === "/auth/change-password" && request.method === "POST") {
      const b = await body(request);
      if (
        !(await passwordOK(
          String(b.current_password || ""),
          ctx.user.password_hash,
        ))
      )
        return err("A palavra-passe atual está incorreta.", 400);
      if (String(b.password || "").length < 6)
        return err("A nova palavra-passe deve ter pelo menos 6 caracteres.");
      await db(ctx, `users?id=eq.${ctx.user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password_hash: await passwordHash(b.password) }),
      });
      await db(
        ctx,
        `sessions?user_id=eq.${ctx.user.id}&id=neq.${ctx.session.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ revoked_at: new Date().toISOString() }),
        },
      );
      await audit(ctx, "alterar palavra-passe", "utilizador", ctx.user.id);
      return json({ ok: true });
    }
    if (route === "/dashboard" && request.method === "GET") {
      const own =
        ctx.user.role === "admin" ? "" : `&started_by=eq.${q(ctx.user.id)}`;
      const returnOwner =
        ctx.user.role === "admin"
          ? ""
          : `&rentals.started_by=eq.${q(ctx.user.id)}`;
      const todayLisbon = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Lisbon",
      }).format(new Date());
      const [allBikes, allKiosks, rentals, faults, returns, dailyClosure] =
        await Promise.all([
        db(ctx, "bikes?active=eq.true&select=id,code,asset_type,status,kiosk_id"),
        db(ctx, "kiosks?active=eq.true&select=*"),
        db(ctx, `rentals?status=eq.Em%20aberto${own}&select=id`),
        db(
          ctx,
          "faults?status=in.(Aberta,Em%20análise,Em%20reparação)&select=*,bikes(code)&order=created_at.desc&limit=8",
        ),
        db(
          ctx,
          `rental_items?returned_at=not.is.null${returnOwner}&select=id,returned_at,rentals!inner(customer_ref,started_by),bikes(code)&order=returned_at.desc&limit=8`,
        ),
        ctx.user.role === "manutencao"
          ? Promise.resolve([])
          : db(
              ctx,
              `daily_closures?report_date=eq.${q(todayLisbon)}&user_id=eq.${q(ctx.user.id)}&select=id,status,kiosk:kiosks(name)&limit=1`,
            ),
        ]);
      const kiosks=ctx.user.role==='funcionario'?allKiosks.filter((k:any)=>k.allows_rentals):allKiosks;
      const visibleKioskIds=new Set(kiosks.map((k:any)=>k.id));
      const bikes=ctx.user.role==='funcionario'?allBikes.filter((b:any)=>visibleKioskIds.has(b.kiosk_id)):allBikes;
      const counts: any = {},
        counts_by_type: any = {};
      bikes.forEach((b: any) => {
        counts[b.status] = (counts[b.status] || 0) + 1;
        const row =
          counts_by_type[b.status] ||
          (counts_by_type[b.status] = {
            total: 0,
            electric: 0,
            conventional: 0,
            child: 0,
            helmet: 0,
            lock: 0,
            stroller: 0,
          });
        row.total++;
        if (row[b.asset_type] !== undefined) row[b.asset_type]++;
      });
      const rentedBikes = bikes.filter((b: any) => b.status === "Alugada"),
        rented = {
          total: rentedBikes.length,
          electric: rentedBikes.filter((b: any) => b.asset_type === "electric").length,
          conventional: rentedBikes.filter((b: any) => b.asset_type === "conventional").length,
          child: rentedBikes.filter((b: any) => b.asset_type === "child").length,
          accessories: rentedBikes.filter((b: any) => ["helmet","lock","stroller"].includes(b.asset_type)).length,
          by_kiosk: kiosks.map((k: any) => {
            const list = rentedBikes.filter((b: any) => b.kiosk_id === k.id);
            return {
              id: k.id,
              name: k.name,
              total: list.length,
              electric: list.filter((b: any) => b.asset_type === "electric").length,
              conventional: list.filter((b: any) => b.asset_type === "conventional").length,
              child: list.filter((b: any) => b.asset_type === "child").length,
              accessories: list.filter((b: any) => ["helmet","lock","stroller"].includes(b.asset_type)).length,
            };
          }),
        };
      return json({
        counts,
        counts_by_type,
        rented:
          ctx.user.role === "manutencao"
            ? { total: 0, electric: 0, conventional: 0, child: 0, accessories: 0, by_kiosk: [] }
            : rented,
        kiosks: kiosks.map((k: any) => ({
          ...k,
          total: bikes.filter((b: any) => b.kiosk_id === k.id).length,
        })),
        open_rentals: ctx.user.role === "manutencao" ? 0 : rentals.length,
        daily_closure: dailyClosure[0] || null,
        pending_faults:
          ctx.user.role === "funcionario" ? 0 : faults.length,
        faults:
          ctx.user.role === "funcionario"
            ? []
            : faults.map((f: any) => ({ ...f, bike_code: f.bikes?.code })),
        recent_returns:
          ctx.user.role === "manutencao"
            ? []
            : returns.map((r: any) => ({
                ...r,
                bike_code: r.bikes?.code,
                customer_ref: r.rentals?.customer_ref,
              })),
      });
    }
    if (route === "/bikes" && request.method === "GET") {
      const kiosks=await db(ctx,`kiosks?active=eq.true${ctx.user.role==='funcionario'?'&allows_rentals=eq.true':''}&select=*&order=name`);
      const kioskIds=kiosks.map((k:any)=>k.id);
      const bikeQuery=ctx.user.role==='funcionario'
        ? `bikes?active=eq.true&kiosk_id=in.(${kioskIds.join(',')})&select=id,code,asset_type,model,kiosk_id,status,active,created_at,updated_at,kiosk:kiosks(id,name,allows_rentals)&order=code`
        : "bikes?select=*,kiosk:kiosks(*)&order=code";
      const bikes=ctx.user.role==='funcionario'&&!kioskIds.length?[]:await db(ctx,bikeQuery);
      return json({ bikes, kiosks });
    }
    if (route === "/bikes/report" && request.method === "GET") {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const [bikes, items, faults, interventions] = await Promise.all([
        db(ctx, "bikes?select=*,kiosk:kiosks(*)&order=code"),
        db(ctx, "rental_items?select=bike_id"),
        db(ctx, "faults?select=id,bike_id,created_at"),
        db(
          ctx,
          "maintenance_interventions?select=intervention_date,fault:faults!inner(bike_id)",
        ),
      ]);
      return json({
        bikes: bikes.map((b: any) => {
          const bikeFaults = faults.filter((f: any) => f.bike_id === b.id),
            dates = [
              ...bikeFaults.map((f: any) => f.created_at),
              ...interventions
                .filter((i: any) => i.fault?.bike_id === b.id)
                .map((i: any) => i.intervention_date),
            ]
              .filter(Boolean)
              .sort();
          return {
            ...b,
            rental_count: items.filter((i: any) => i.bike_id === b.id).length,
            fault_count: bikeFaults.length,
            last_maintenance_at: dates.at(-1) || null,
          };
        }),
      });
    }
    if (route === "/bikes" && request.method === "POST") {
      if (!allow(ctx, "admin"))
        return err("Apenas administradores podem criar itens de inventário.", 403);
      const b = await body(request),types:any={electric:{prefix:'E',model:'Bicicleta elétrica'},conventional:{prefix:'C',model:'Bicicleta convencional'},child:{prefix:'I',model:'Bicicleta infantil'},helmet:{prefix:'CAP',model:'Capacete'},lock:{prefix:'CAD',model:'Cadeado'},stroller:{prefix:'CAR',model:'Carrinho de bebé'}},assetType=types[b.asset_type]?b.asset_type:(b.type==='E'?'electric':'conventional'),definition=types[assetType],number=String(b.number||b.code||'').replace(/^[A-Z]+/i,'');
      if (!/^\d{1,6}$/.test(number))
        return err("Indique um número válido para a bicicleta.");
      const code = definition.prefix + number.padStart(3, "0");
      const rows = await db(ctx, "bikes", {
        method: "POST",
        body: JSON.stringify({
          code,
          model:b.model||definition.model,
          asset_type:assetType,
          kiosk_id: b.kiosk_id,
          status: "Disponível",
        }),
      });
      await audit(ctx, "criar", "bicicleta", rows[0].id, null, rows[0]);
      return json(rows[0], 201);
    }
    if (
      parts[0] === "bikes" &&
      parts[1] &&
      parts[2] === "history" &&
      request.method === "GET"
    ) {
      if (!["admin", "manutencao"].includes(ctx.user.role))
        return err("Acesso reservado a administradores e manutenção.", 403);
      const itemsPromise =
        ctx.user.role === "manutencao"
          ? Promise.resolve([])
          : db(
              ctx,
              `rental_items?bike_id=eq.${parts[1]}&select=*,return_kiosk:kiosks(*),returned_by_user:users!rental_items_returned_by_fkey(full_name),rental:rentals(*,start_kiosk:kiosks(*),started_by_user:users!rentals_started_by_fkey(full_name),returned_by_user:users!rentals_returned_by_fkey(full_name))&order=returned_at.desc.nullsfirst`,
            );
      const [bike, items, faults] = await Promise.all([
        db(ctx, `bikes?id=eq.${parts[1]}&select=*,kiosk:kiosks(*)`),
        itemsPromise,
        db(
          ctx,
          `faults?bike_id=eq.${parts[1]}&select=*,created_by_user:users!faults_created_by_fkey(full_name),interventions:maintenance_interventions(*,created_by_user:users!maintenance_interventions_created_by_fkey(full_name))&order=created_at.desc`,
        ),
      ]);
      if (!bike[0]) return err("Bicicleta não encontrada.", 404);
      return json({ bike: bike[0], rental_items: items, faults });
    }
    if (parts[0] === "bikes" && parts[1] && request.method === "PATCH") {
      if (!["admin", "manutencao"].includes(ctx.user.role))
        return err(
          "Apenas administradores e manutenção podem alterar bicicletas.",
          403,
        );
      const old = (await db(ctx, `bikes?id=eq.${parts[1]}&select=*`))[0];
      if (!old) return err("Bicicleta não encontrada.", 404);
      const b = await body(request),
        allowed = [
          "model",
          "kiosk_id",
          "status",
          "notes",
          "active",
          "photo_url",
        ];
      const update = Object.fromEntries(
        Object.entries(b).filter(([k]) => allowed.includes(k)),
      );
      const rows = await db(ctx, `bikes?id=eq.${parts[1]}`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      if (["Avariada", "Em manutenção"].includes(String(update.status || ""))) {
        const existing = await db(
          ctx,
          `faults?bike_id=eq.${parts[1]}&status=in.(Aberta,Em%20análise,Em%20reparação)&select=id&limit=1`,
        );
        if (!existing.length) {
          const description =
            String(b.fault_description || "").trim() ||
            `Bicicleta marcada como ${update.status} na gestão da frota.`;
          const created = await db(ctx, "faults", {
            method: "POST",
            body: JSON.stringify({
              bike_id: parts[1],
              created_by: ctx.user.id,
              origin: "comunicada diretamente",
              category: "outra",
              description,
              severity: "Média",
              usable: false,
              status:
                update.status === "Em manutenção" ? "Em reparação" : "Aberta",
            }),
          });
          await audit(
            ctx,
            "registar avaria automática",
            "avaria",
            created[0]?.id,
            null,
            created[0],
          );
        }
      }
      await audit(
        ctx,
        "alterar",
        "bicicleta",
        parts[1],
        old,
        rows[0],
        b.justification,
      );
      return json(rows[0]);
    }
    if (parts[0] === "rentals" && ctx.user.role === "manutencao")
      return err("O perfil de manutenção não tem acesso aos alugueres.", 403);
    if (route === "/rentals" && request.method === "GET") {
      const owner =
        ctx.user.role === "admin" ? "" : `&started_by=eq.${q(ctx.user.id)}`;
      const discrepancyOwner =
        ctx.user.role === "admin" ? "" : `&created_by=eq.${q(ctx.user.id)}`;
      const [rentals, bikes, kiosks, discrepancies] = await Promise.all([
        db(
          ctx,
          `rentals?select=*,start_kiosk:kiosks(*),started_by_user:users!rentals_started_by_fkey(full_name),returned_by_user:users!rentals_returned_by_fkey(full_name),items:rental_items(*,bike:bikes(*),return_kiosk:kiosks(*),returned_by_user:users!rental_items_returned_by_fkey(full_name))${owner}&order=started_at.desc&limit=500`,
        ),
        db(
          ctx,
          "bikes?active=eq.true&status=eq.Disponível&select=*,kiosk:kiosks!inner(*)&kiosk.allows_rentals=eq.true&order=code",
        ),
        db(
          ctx,
          "kiosks?active=eq.true&allows_rentals=eq.true&select=*&order=name",
        ),
        db(
          ctx,
          `rental_discrepancies?select=*,rental:rentals(reference,customer_ref),created_by_user:users!rental_discrepancies_created_by_fkey(full_name),resolved_by_user:users!rental_discrepancies_resolved_by_fkey(full_name)${discrepancyOwner}&order=created_at.desc&limit=500`,
        ),
      ]);
      return json({ rentals, available_bikes: bikes, kiosks, discrepancies });
    }
    if (route === "/rentals" && request.method === "POST") {
      const b = await body(request);
      if (
        !b.customer_ref?.trim() ||
        !Array.isArray(b.bike_ids) ||
        !b.bike_ids.length
      )
        return err("Indique o cliente e pelo menos uma bicicleta.");
      const rows = await db(ctx, "rpc/start_rental", {
        method: "POST",
        body: JSON.stringify({
          p_customer_ref: b.customer_ref.trim(),
          p_start_kiosk_id: b.start_kiosk_id,
          p_bike_ids: b.bike_ids,
          p_user_id: ctx.user.id,
        }),
      });
      return json(rows, 201);
    }
    if (
      parts[0] === "rentals" &&
      parts[1] &&
      parts[2] === "add-bike" &&
      request.method === "POST"
    ) {
      const rental = (
        await db(ctx, `rentals?id=eq.${q(parts[1])}&select=id,started_by,status`)
      )[0];
      if (!rental) return err("Aluguer não encontrado.", 404);
      if (rental.status !== "Em aberto")
        return err("Só é possível corrigir um aluguer em aberto.", 409);
      if (ctx.user.role !== "admin" && rental.started_by !== ctx.user.id)
        return err("Não pode corrigir alugueres de outro utilizador.", 403);
      const b = await body(request);
      if (!b.bike_id) return err("Selecione a bicicleta a adicionar.");
      const bike = (
        await db(
          ctx,
          `bikes?id=eq.${q(String(b.bike_id))}&active=eq.true&status=eq.Disponível&select=id`,
        )
      )[0];
      if (!bike)
        return err(
          "A bicicleta já não está disponível. Atualize a página ou comunique uma discrepância.",
          409,
        );
      const result = await db(ctx, "rpc/add_bike_to_open_rental", {
        method: "POST",
        body: JSON.stringify({
          p_rental_id: parts[1],
          p_bike_id: b.bike_id,
          p_user_id: ctx.user.id,
        }),
      });
      return json(result);
    }
    if (
      parts[0] === "rentals" &&
      parts[1] &&
      parts[2] === "remove-bike" &&
      request.method === "POST"
    ) {
      const rental = (
        await db(ctx, `rentals?id=eq.${q(parts[1])}&select=id,started_by,status`)
      )[0];
      if (!rental) return err("Aluguer não encontrado.", 404);
      if (rental.status !== "Em aberto")
        return err("Só é possível corrigir um aluguer em aberto.", 409);
      if (ctx.user.role !== "admin" && rental.started_by !== ctx.user.id)
        return err("Não pode corrigir alugueres de outro utilizador.", 403);
      const b = await body(request);
      const openItems = await db(
        ctx,
        `rental_items?rental_id=eq.${q(parts[1])}&returned_at=is.null&select=id`,
      );
      if (openItems.length <= 1)
        return err(
          "Um aluguer tem de manter pelo menos uma bicicleta. Contacte o administrador se pretender anulá-lo.",
          409,
        );
      const result = await db(ctx, "rpc/remove_bike_from_open_rental", {
        method: "POST",
        body: JSON.stringify({
          p_rental_id: parts[1],
          p_rental_item_id: b.rental_item_id,
          p_user_id: ctx.user.id,
        }),
      });
      return json(result);
    }
    if (
      parts[0] === "rentals" &&
      parts[1] &&
      parts[2] === "discrepancies" &&
      request.method === "POST"
    ) {
      const rental = (
        await db(ctx, `rentals?id=eq.${q(parts[1])}&select=id,started_by,status`)
      )[0];
      if (!rental) return err("Aluguer não encontrado.", 404);
      if (rental.status !== "Em aberto")
        return err("Só é possível comunicar uma discrepância num aluguer em aberto.", 409);
      if (ctx.user.role !== "admin" && rental.started_by !== ctx.user.id)
        return err("Não pode alterar alugueres de outro utilizador.", 403);
      const b = await body(request),
        bikeCode = String(b.bike_code || "").trim().toUpperCase(),
        description = String(b.description || "").trim();
      if (!bikeCode || !description)
        return err("Indique o código da bicicleta e descreva o problema.");
      const rows = await db(ctx, "rental_discrepancies", {
        method: "POST",
        body: JSON.stringify({
          rental_id: parts[1],
          bike_code: bikeCode,
          description,
          created_by: ctx.user.id,
        }),
      });
      await audit(
        ctx,
        "comunicar discrepância",
        "aluguer",
        parts[1],
        null,
        rows[0],
      );
      return json(rows[0], 201);
    }
    if (
      parts[0] === "rental-discrepancies" &&
      parts[1] &&
      parts[2] === "resolve" &&
      request.method === "PATCH"
    ) {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const old = (
        await db(
          ctx,
          `rental_discrepancies?id=eq.${q(parts[1])}&select=*`,
        )
      )[0];
      if (!old) return err("Discrepância não encontrada.", 404);
      const b = await body(request),
        resolution = String(b.resolution || "").trim();
      if (!resolution) return err("Descreva como a discrepância foi resolvida.");
      const rows = await db(ctx, `rental_discrepancies?id=eq.${old.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "Resolvida",
          resolution,
          resolved_by: ctx.user.id,
          resolved_at: new Date().toISOString(),
        }),
      });
      await audit(
        ctx,
        "resolver discrepância",
        "aluguer",
        old.rental_id,
        old,
        rows[0],
      );
      return json(rows[0]);
    }
    if (
      parts[0] === "rentals" &&
      parts[2] === "return" &&
      request.method === "POST"
    ) {
      const rental = (
        await db(
          ctx,
          `rentals?id=eq.${parts[1]}&select=id,started_by,start_kiosk_id`,
        )
      )[0];
      if (!rental) return err("Aluguer não encontrado.", 404);
      if (ctx.user.role !== "admin" && rental.started_by !== ctx.user.id)
        return err("Não pode alterar alugueres de outro utilizador.", 403);
      const b = await body(request);
      if (!b.items?.length) return err("Não existem bicicletas por devolver.");
      const result = await db(ctx, "rpc/return_rental_items", {
        method: "POST",
        body: JSON.stringify({
          p_rental_id: parts[1],
          p_return_kiosk_id:
            b.return_kiosk_id ||
            ctx.user.usual_kiosk_id ||
            rental.start_kiosk_id,
          p_items: b.items,
          p_user_id: ctx.user.id,
        }),
      });
      return json(result);
    }
    if (route === "/faults/report-options" && request.method === "GET") {
      const rentalKiosks=ctx.user.role==='funcionario'?await db(ctx,'kiosks?active=eq.true&allows_rentals=eq.true&select=id'):[];
      const kioskIds=rentalKiosks.map((k:any)=>k.id),kioskFilter=ctx.user.role==='funcionario'?`&kiosk_id=in.(${kioskIds.join(',')})`:'';
      const bikes = ctx.user.role==='funcionario'&&!kioskIds.length?[]:await db(ctx,`bikes?active=eq.true${kioskFilter}&select=id,code,asset_type,model,kiosk_id&order=code`);
      return json({ bikes });
    }
    if (route === "/faults" && request.method === "GET") {
      if (!['admin','manutencao'].includes(ctx.user.role))
        return err("Acesso reservado a administradores e manutenção.", 403);
      const [faults, bikes] = await Promise.all([
        db(
          ctx,
          "faults?select=*,bike:bikes(*),created_by_user:users!faults_created_by_fkey(full_name)&order=created_at.desc&limit=1000",
        ),
        db(ctx, "bikes?active=eq.true&select=*&order=code"),
      ]);
      return json({ faults, bikes });
    }
    if (route === "/faults" && request.method === "POST") {
      const b = await body(request);
      if (!b.bike_id || !b.description?.trim())
        return err("Selecione a bicicleta e descreva a avaria.");
      const rows = await db(ctx, "rpc/create_fault", {
        method: "POST",
        body: JSON.stringify({
          p_bike_id: b.bike_id,
          p_origin: "comunicada diretamente",
          p_category: b.category,
          p_description: b.description,
          p_severity: b.severity,
          p_usable: !!b.usable,
          p_user_id: ctx.user.id,
        }),
      });
      return json(rows, 201);
    }
    if (parts[0] === "faults" && parts[1] && request.method === "PATCH") {
      if (!["admin", "manutencao"].includes(ctx.user.role))
        return err("Acesso reservado a administradores e manutenção.", 403);
      const b = await body(request);
      const result = await db(ctx, "rpc/update_fault", {
        method: "POST",
        body: JSON.stringify({
          p_fault_id: parts[1],
          p_status: b.status,
          p_final_bike_status: b.final_bike_status || null,
          p_user_id: ctx.user.id,
          p_note: b.note || null,
        }),
      });
      if (String(b.note || "").trim())
        await db(ctx, "maintenance_interventions", {
          method: "POST",
          body: JSON.stringify({
            fault_id: parts[1],
            description: String(b.note).trim(),
            created_by: ctx.user.id,
          }),
        });
      return json(result);
    }
    if (route === "/users" && request.method === "GET") {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const [users, kiosks] = await Promise.all([
        db(
          ctx,
          "users?select=id,full_name,username,role,usual_kiosk_id,active,last_login_at,created_at&order=full_name",
        ),
        db(ctx, "kiosks?active=eq.true&allows_rentals=eq.true&select=*"),
      ]);
      return json({ users, kiosks });
    }
    if (route === "/users" && request.method === "POST") {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const b = await body(request);
      if (!b.full_name || !b.username || String(b.password || "").length < 6)
        return err(
          "Preencha os dados e use uma palavra-passe com pelo menos 6 caracteres.",
        );
      const role =
        b.role === "admin"
          ? "admin"
          : b.role === "manutencao"
            ? "manutencao"
            : "funcionario";
      const rows = await db(ctx, "users", {
        method: "POST",
        body: JSON.stringify({
          full_name: b.full_name,
          username: String(b.username).toLowerCase(),
          password_hash: await passwordHash(b.password),
          role,
          usual_kiosk_id: b.usual_kiosk_id || null,
        }),
      });
      await audit(
        ctx,
        "criar",
        "utilizador",
        rows[0].id,
        null,
        cleanUser(rows[0]),
      );
      return json(cleanUser(rows[0]), 201);
    }
    if (
      parts[0] === "users" &&
      parts[1] &&
      parts.length === 2 &&
      request.method === "PATCH"
    ) {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const old = (await db(ctx, `users?id=eq.${parts[1]}&select=*`))[0],
        b = await body(request);
      if (!old) return err("Utilizador não encontrado.", 404);
      if (
        old.username === "admin" &&
        (b.active === false ||
          (b.role && b.role !== "admin") ||
          (b.username && String(b.username).trim().toLowerCase() !== "admin"))
      )
        return err(
          "A conta admin está protegida e não pode ser desativada, despromovida ou renomeada.",
          400,
        );
      if (
        parts[1] === ctx.user.id &&
        (b.active === false || (b.role && b.role !== "admin"))
      )
        return err(
          "Não pode desativar nem retirar o perfil de administrador da sua própria conta.",
          400,
        );
      const allowed = [
        "full_name",
        "username",
        "role",
        "usual_kiosk_id",
        "active",
      ];
      const update: any = Object.fromEntries(
        Object.entries(b).filter(([k]) => allowed.includes(k)),
      );
      if (update.username !== undefined) {
        update.username = String(update.username).trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,50}$/.test(update.username))
          return err(
            "O nome de utilizador deve ter entre 3 e 50 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.",
          );
      }
      if (update.full_name !== undefined && !String(update.full_name).trim())
        return err("O nome não pode ficar vazio.");
      if (update.full_name !== undefined)
        update.full_name = String(update.full_name).trim();
      if (update.role !== undefined)
        update.role =
          update.role === "admin"
            ? "admin"
            : update.role === "manutencao"
              ? "manutencao"
              : "funcionario";
      const rows = await db(ctx, `users?id=eq.${parts[1]}`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      await audit(
        ctx,
        "alterar",
        "utilizador",
        parts[1],
        cleanUser(old),
        cleanUser(rows[0]),
      );
      return json(cleanUser(rows[0]));
    }
    if (
      parts[0] === "users" &&
      parts[2] === "password" &&
      request.method === "POST"
    ) {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const b = await body(request);
      if (String(b.password || "").length < 6)
        return err("A palavra-passe deve ter pelo menos 6 caracteres.");
      await db(ctx, `users?id=eq.${parts[1]}`, {
        method: "PATCH",
        body: JSON.stringify({ password_hash: await passwordHash(b.password) }),
      });
      await db(ctx, `sessions?user_id=eq.${parts[1]}`, {
        method: "PATCH",
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      });
      await audit(ctx, "redefinir palavra-passe", "utilizador", parts[1]);
      return json({ ok: true });
    }
    if (parts[0] === "daily-closures" && ctx.user.role === "manutencao")
      return err(
        "O perfil de manutenção não tem acesso aos fechos diários.",
        403,
      );
    if (route === "/daily-closures" && request.method === "GET") {
      const owner =
        ctx.user.role === "admin" ? "" : `&user_id=eq.${q(ctx.user.id)}`;
      const [closures, kiosks] = await Promise.all([
        db(
          ctx,
          `daily_closures?select=*,kiosk:kiosks(*),user:users(full_name,username)&order=report_date.desc,created_at.desc${owner}&limit=500`,
        ),
        db(
          ctx,
          "kiosks?active=eq.true&allows_rentals=eq.true&select=*&order=name",
        ),
      ]);
      return json({ closures, kiosks });
    }
    if (route === "/daily-closures/stats" && request.method === "GET") {
      const url = new URL(request.url),
        reportDate = url.searchParams.get("date") || "",
        kioskId = url.searchParams.get("kiosk_id") || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !kioskId)
        return err("Indique uma data e um quiosque válidos.");
      const stats = await db(ctx, "rpc/daily_closure_stats", {
        method: "POST",
        body: JSON.stringify({
          p_report_date: reportDate,
          p_kiosk_id: kioskId,
          p_user_id: ctx.user.id,
        }),
      });
      return json({
        stats: stats || {
          rental_count: 0,
          bike_count: 0,
          electric_count: 0,
          conventional_count: 0,
          child_count: 0,
          accessory_count: 0,
        },
      });
    }
    if (route === "/daily-closures" && request.method === "POST") {
      const b = await body(request),
        reportDate = String(b.report_date || ""),
        kioskId = String(b.kiosk_id || ""),
        status = b.status === "Submetido" ? "Submetido" : "Rascunho",
        cardTotal = Number(b.card_total);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !kioskId)
        return err("Indique uma data e um quiosque válidos.");
      if (!Number.isFinite(cardTotal) || cardTotal < 0)
        return err("Indique um valor de Multibanco válido.");
      const kiosk = (
        await db(
          ctx,
          `kiosks?id=eq.${q(kioskId)}&active=eq.true&allows_rentals=eq.true&select=id`,
        )
      )[0];
      if (!kiosk) return err("O quiosque selecionado não permite alugueres.");
      const existing = (
        await db(
          ctx,
          `daily_closures?report_date=eq.${q(reportDate)}&kiosk_id=eq.${q(kioskId)}&user_id=eq.${q(ctx.user.id)}&select=*`,
        )
      )[0];
      if (existing?.status === "Submetido" && ctx.user.role !== "admin")
        return err(
          "Este fecho já foi submetido. Peça a um administrador para o reabrir.",
          409,
        );
      let receiptPath = existing?.receipt_path || null,
        receiptName = existing?.receipt_name || null,
        receiptType = existing?.receipt_content_type || null;
      if (b.receipt?.data) {
        const safeName = String(b.receipt.name || "talao").replace(
            /[^a-zA-Z0-9._-]/g,
            "_",
          ),
          ext = safeName.includes(".") ? safeName.split(".").pop() : "bin";
        receiptPath = `${ctx.user.id}/${reportDate}-${kioskId}.${ext}`;
        const uploadError = await uploadReceipt(
          ctx,
          receiptPath,
          String(b.receipt.data),
          String(b.receipt.type || ""),
        );
        if (uploadError) return uploadError;
        receiptName = String(b.receipt.name || "Talão");
        receiptType = String(b.receipt.type || "application/octet-stream");
      }
      if (status === "Submetido" && !receiptPath)
        return err("Anexe o talão de fecho de caixa antes de submeter.");
      const stats = await db(ctx, "rpc/daily_closure_stats", {
        method: "POST",
        body: JSON.stringify({
          p_report_date: reportDate,
          p_kiosk_id: kioskId,
          p_user_id: ctx.user.id,
        }),
      });
      const values = {
        report_date: reportDate,
        kiosk_id: kioskId,
        user_id: ctx.user.id,
        rental_count: Number(stats?.rental_count || 0),
        bike_count: Number(stats?.bike_count || 0),
        electric_count: Number(stats?.electric_count || 0),
        conventional_count: Number(stats?.conventional_count || 0),
        child_count: Number(stats?.child_count || 0),
        accessory_count: Number(stats?.accessory_count || 0),
        card_total: cardTotal,
        receipt_path: receiptPath,
        receipt_name: receiptName,
        receipt_content_type: receiptType,
        observations: String(b.observations || "").trim() || null,
        status,
        submitted_at: status === "Submetido" ? new Date().toISOString() : null,
      };
      const rows = existing
        ? await db(ctx, `daily_closures?id=eq.${existing.id}`, {
            method: "PATCH",
            body: JSON.stringify(values),
          })
        : await db(ctx, "daily_closures", {
            method: "POST",
            body: JSON.stringify(values),
          });
      await audit(
        ctx,
        status === "Submetido" ? "submeter" : "guardar rascunho",
        "fecho diário",
        rows[0].id,
        existing || null,
        rows[0],
      );
      return json(rows[0], existing ? 200 : 201);
    }
    if (
      parts[0] === "daily-closures" &&
      parts[1] &&
      parts[2] === "receipt" &&
      request.method === "GET"
    ) {
      const closure = (
        await db(
          ctx,
          `daily_closures?id=eq.${q(parts[1])}&select=id,user_id,receipt_path,receipt_name,receipt_content_type`,
        )
      )[0];
      if (!closure?.receipt_path) return err("Talão não encontrado.", 404);
      if (ctx.user.role !== "admin" && closure.user_id !== ctx.user.id)
        return err("Não pode consultar este talão.", 403);
      const response = await readReceipt(ctx, closure.receipt_path);
      return new Response(response.body, {
        status: 200,
        headers: {
          "Content-Type":
            closure.receipt_content_type ||
            response.headers.get("Content-Type") ||
            "application/octet-stream",
          "Content-Disposition": `inline; filename="${String(closure.receipt_name || "talao").replace(/"/g, "")}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (
      parts[0] === "daily-closures" &&
      parts[1] &&
      parts[2] === "reopen" &&
      request.method === "PATCH"
    ) {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const old = (
        await db(ctx, `daily_closures?id=eq.${q(parts[1])}&select=*`)
      )[0];
      if (!old) return err("Fecho diário não encontrado.", 404);
      const rows = await db(ctx, `daily_closures?id=eq.${old.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Rascunho", submitted_at: null }),
      });
      await audit(ctx, "reabrir", "fecho diário", old.id, old, rows[0]);
      return json(rows[0]);
    }
    if (route === "/activity" && request.method === "GET") {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const rows = await db(
        ctx,
        "audit_log?select=*,user:users(full_name,username)&order=created_at.desc&limit=500",
      );
      return json({ activity: rows });
    }
    return err("Página ou operação não encontrada.", 404);
  } catch (e) {
    console.error(e);
    const m = String((e as Error).message);
    if (e instanceof DbError) {
      if (e.code === "missing_url")
        return err(
          "Falta configurar SUPABASE_URL no Cloudflare e voltar a publicar.",
          500,
        );
      if (e.code === "missing_key")
        return err(
          "Falta configurar a chave secreta do Supabase no Cloudflare e voltar a publicar.",
          500,
        );
      if (e.status === 401 || e.status === 403)
        return err(
          `O Supabase recusou a chave configurada (erro ${e.status}). Confirme a chave service_role e volte a publicar.`,
          500,
        );
      if (e.status === 404 || e.code === "PGRST205")
        return err(
          `A base de dados não encontrou uma tabela necessária (${e.code}). Confirme se executou integralmente o ficheiro 001_initial.sql e se o esquema public está exposto.`,
          500,
        );
      if (e.code === "23505")
        return err("Já existe um registo com estes dados.", 409);
      return err(
        `Erro de base de dados: código ${e.code}, estado ${e.status}.`,
        500,
      );
    }
    if (m.includes("bike_not_available"))
      return err(
        "Uma das bicicletas já não está disponível. Atualize a página.",
        409,
      );
    if (m.includes("duplicate") || m.includes("23505"))
      return err("Já existe um registo com estes dados.", 409);
    const name = e instanceof Error ? e.name : "Erro desconhecido";
    return err(`Erro interno ${name}: ${m.slice(0, 180)}`, 500);
  }
};
