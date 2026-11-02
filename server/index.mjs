import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { loadCases } from "./load.mjs";
import { Room } from "./room.mjs";
import { Store } from "./store.mjs";
import { validateCase } from "./editor.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLIENT = join(ROOT, "client");
const CASES = loadCases(join(ROOT, "cases"));
const FORCED = process.env.CASE;
const pickCase = () =>
  (FORCED && CASES.find((item) => item.id === FORCED)) ||
  CASES[Math.floor(Math.random() * CASES.length)];
const PORT = Number(process.env.PORT ?? 8080);
const DB_FILE = process.env.DB ?? join(ROOT, "data", "blind-witness.db");

mkdirSync(dirname(DB_FILE), { recursive: true });
const store = new Store(DB_FILE);

const SESSION_COOKIE = "sid";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const API_ERRORS = {
  bad_name: [400, "Имя от 2 символов"],
  weak_password: [400, "Пароль от 6 символов"],
  name_taken: [409, "Такое имя уже занято"],
  bad_credentials: [401, "Неверное имя или пароль"],
};

function cookieOf(header, key) {
  for (const part of String(header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === key) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

const currentUser = (req) => store.userByToken(cookieOf(req.headers.cookie, SESSION_COOKIE));

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw new Error("bad_json");
  }
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

async function api(req, res, url) {
  try {
    const path = url.pathname;

    if (path === "/api/me" && req.method === "GET") {
      const user = currentUser(req);
      return json(res, 200, user ? { user, stats: store.stats(user.id) } : { user: null });
    }

    if (path === "/api/leaderboard" && req.method === "GET") {
      return json(res, 200, { rows: store.leaderboard() });
    }

    if ((path === "/api/register" || path === "/api/login") && req.method === "POST") {
      const body = await readJson(req);
      const user =
        path === "/api/register"
          ? store.register(body.name, body.password)
          : store.login(body.name, body.password);
      const token = store.createSession(user.id);
      return json(res, 200, { user, stats: store.stats(user.id) }, { "set-cookie": sessionCookie(token) });
    }

    if (path === "/api/logout" && req.method === "POST") {
      store.destroySession(cookieOf(req.headers.cookie, SESSION_COOKIE));
      return json(res, 200, { user: null }, { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    }

    if (path === "/api/validate" && req.method === "POST") {
      const body = await readJson(req, 262144);
      return json(res, 200, validateCase(body));
    }

    return json(res, 404, { error: "not_found" });
  } catch (error) {
    const known = API_ERRORS[error.message];
    if (!known) console.error("api", url.pathname, error);
    const [status, message] = known ?? [500, "Не получилось"];
    return json(res, status, { error: message });
  }
}

const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) {
    const room = new Room(code, pickCase(), (name, message) => {
      const player = room.players.get(name);
      if (player?.ws?.readyState === 1) player.ws.send(JSON.stringify(message));
    });
    // Дело закрыто — всем игрокам с аккаунтом идёт строка в таблицу компании.
    room.onFinish = (verdict) => {
      for (const player of room.players.values()) {
        if (player.userId) store.finish(player.userId, verdict.result === "win");
      }
    };
    rooms.set(code, room);
  }
  return rooms.get(code);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname.startsWith("/api/")) return api(req, res, url);

  const file = url.pathname === "/" ? "/index.html" : url.pathname === "/editor" ? "/editor.html" : url.pathname;
  const path = join(CLIENT, normalize(file).replace(/^(\.\.[/\\])+/, ""));

  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Не найдено");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket, request) => {
  const user = store.userByToken(cookieOf(request.headers.cookie, SESSION_COOKIE));
  let name = null;
  let room = null;

  const reply = (message) => socket.send(JSON.stringify(message));
  const fail = (code) => reply({ t: "error", code });

  socket.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return fail("bad_message");
    }

    try {
      if (msg.t === "join") {
        room = getRoom(String(msg.code ?? "test").slice(0, 16));
        // С аккаунтом имя берётся из сессии: чужим именем не войти.
        name = user ? user.name : String(msg.name ?? "").trim().slice(0, 24);
        room.join(name, user?.id ?? null, msg.mode);
        const player = room.players.get(name);
        player.ws = socket;
        room.send(name, room.state(name));
        if (room.started) room.send(name, room.packetFor(name));
        return;
      }

      if (!room || !name) return fail("not_joined");

      switch (msg.t) {
        case "start": return room.start(name);
        case "attach": return room.attach(name, msg.clueId);
        case "detach": return room.detach(name, msg.clueId);
        case "note": return room.note(name, msg.text, msg.secret);
        case "move": return room.move(name, msg.id, msg.x, msg.y);
        case "suspect": return room.suspect(name, msg.suspectId, msg.on !== false);
        case "chat": return room.say(name, msg.text);
        case "ask": await room.ask(name, msg.suspectId, msg.text); return;
        case "accuse": return room.accuse(name, msg.suspect);
        default: return fail("unknown_type");
      }
    } catch (error) {
      fail(error.message);
    }
  });

  socket.on("close", () => {
    if (room && name) {
      const player = room.players.get(name);
      if (player) player.ws = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Слепой свидетель: http://localhost:${PORT}`);
});
