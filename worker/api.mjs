// HTTP-API прода: те же ручки и те же тексты, что у локального server/index.mjs.
import { validateCase } from "../server/editor.mjs";
import { AVATAR_LIMIT, sniffImage } from "../server/avatars.mjs";
import { D1Store } from "./d1.mjs";

const SESSION_COOKIE = "sid";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

const API_ERRORS = {
  bad_name: [400, "Имя от 2 символов"],
  weak_password: [400, "Пароль от 6 символов"],
  name_taken: [409, "Такое имя уже занято"],
  bad_credentials: [401, "Неверное имя или пароль"],
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

export function cookieOf(header, key) {
  for (const part of String(header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === key) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

const sessionCookie = (token) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_MAX_AGE}`;

export async function api(request, env, url) {
  const store = new D1Store(env.DB);
  const path = url.pathname;

  try {
    if (path === "/api/me" && request.method === "GET") {
      const user = await store.userByToken(cookieOf(request.headers.get("cookie"), SESSION_COOKIE));
      return json(user ? { user, stats: await store.stats(user.id) } : { user: null });
    }

    if (path === "/api/leaderboard" && request.method === "GET") {
      return json({ rows: await store.leaderboard() });
    }

    if ((path === "/api/register" || path === "/api/login") && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const user =
        path === "/api/register"
          ? await store.register(body.name, body.password)
          : await store.login(body.name, body.password);
      const token = await store.createSession(user.id);
      return json({ user, stats: await store.stats(user.id) }, 200, { "set-cookie": sessionCookie(token) });
    }

    if (path === "/api/logout" && request.method === "POST") {
      await store.destroySession(cookieOf(request.headers.get("cookie"), SESSION_COOKIE));
      return json({ user: null }, 200, {
        "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
      });
    }

    if (path === "/api/validate" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      return json(validateCase(body));
    }

    // Лицо лежит в D1 по id аккаунта, а в ссылке стоит имя: так игроку не нужно знать id.
    if (path.startsWith("/api/avatar")) {
      const who = path.slice("/api/avatar/".length);
      const user = await store.userByToken(cookieOf(request.headers.get("cookie"), SESSION_COOKIE));

      if (request.method === "GET" || request.method === "HEAD") {
        const id = who ? await store.idByKey(decodeURIComponent(who)) : null;
        const face = id ? await store.avatar(id) : null;
        if (!face) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=60" } });
        return new Response(request.method === "HEAD" ? null : new Uint8Array(face.bytes), {
          headers: {
            "content-type": face.mime ?? "image/png",
            "cache-control": "public, max-age=300",
            "x-content-type-options": "nosniff",
          },
        });
      }

      if (!user) return json({ error: "Сначала войдите в аккаунт" }, 401);

      if (request.method === "DELETE") {
        await store.removeAvatar(user.id);
        return json({ ok: true });
      }

      if (request.method === "POST") {
        // В D1 кладём ArrayBuffer: Uint8Array bind() превращает в строку кодов через запятую.
        const raw = await request.arrayBuffer();
        const body = new Uint8Array(raw);
        if (body.length > AVATAR_LIMIT) return json({ error: "Картинка больше 200 КБ" }, 413);
        const kind = sniffImage(body);
        if (!kind) return json({ error: "Только PNG, JPEG или WebP" }, 415);
        await store.putAvatar(user.id, kind.mime, raw);
        return json({ ok: true, url: `/api/avatar/${encodeURIComponent(user.name)}` });
      }
    }

    return json({ error: "not_found" }, 404);
  } catch (error) {
    const [status, message] = API_ERRORS[error.message] ?? [500, "Не получилось"];
    return json({ error: message }, status);
  }
}
