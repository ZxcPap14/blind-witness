import { Room } from "../server/room.mjs";
import { buildCase } from "../server/blocks.mjs";
import { api, cookieOf } from "./api.mjs";
import { D1Store } from "./d1.mjs";
import lighthouse from "../cases/lighthouse-01.json";
import theatre from "../cases/theatre-02.json";
import sosny from "../cases/sosny-03.json";
import blocks from "../cases/blocks/lighthouse.json";

const CASES = [lighthouse, theatre, sosny];
const pickCase = (id) => {
  if (id === blocks.id) return buildCase(blocks);
  if (id) {
    const forced = CASES.find((item) => item.id === id);
    if (forced) return forced;
  }
  const sources = [...CASES.map((item) => () => item), () => buildCase(blocks)];
  return sources[Math.floor(Math.random() * sources.length)]();
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) return api(request, env, url);
    if (url.pathname === "/ws") return openRoom(request, env, url);

    return env.ASSETS.fetch(request);
  },
};

// Имя и id игрока берём из сессии здесь: комната не верит сообщению клиента.
async function openRoom(request, env, url) {
  const user = await new D1Store(env.DB).userByToken(cookieOf(request.headers.get("cookie"), "sid"));
  const headers = new Headers(request.headers);
  headers.set("x-user-id", user ? String(user.id) : "");
  headers.set("x-user-name", user?.name ?? "");
  const code = (url.searchParams.get("room") || "default").slice(0, 16);
  return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(request, { headers }));
}

// Одна комната = один Durable Object. Состояние живёт в памяти, пока открыт сокет.
export class RoomObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.saved = null;
    this.room = null;
    // Комната переживает выгрузку объекта: состояние поднимаем из хранилища до первого запроса.
    state.blockConcurrencyWhile(async () => {
      this.saved = (await state.storage.get("room")) ?? null;
    });
  }

  roomFor(code, caseId) {
    if (!this.room) {
      const data = this.saved;
      const room = new Room(data?.code ?? code, pickCase(data?.caseId ?? caseId), (name, message) => {
        const socket = room.players.get(name)?.ws;
        if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
      });
      if (data) room.load(data);
      room.persist = () => this.state.storage.put("room", room.snapshot());
      // Дело закрыто — каждому игроку с аккаунтом строка в таблицу компании.
      // shortcut: запись в D1 не ждём, дело к этому моменту уже закрыто.
      room.onFinish = (verdict) => {
        const store = new D1Store(this.env.DB);
        for (const player of room.players.values()) {
          if (player.userId) store.finish(player.userId, verdict.result === "win").catch(() => {});
        }
      };
      this.room = room;
    }
    return this.room;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = (url.searchParams.get("room") || "default").slice(0, 16);

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Нужен WebSocket", { status: 426 });
    }

    const room = this.roomFor(code, url.searchParams.get("case"));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const session = { name: null };
    const userId = Number(request.headers.get("x-user-id")) || null;
    const userName = request.headers.get("x-user-name") ?? "";
    const fail = (code) => server.send(JSON.stringify({ t: "error", code }));

    server.addEventListener("message", async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return fail("bad_message");
      }

      try {
        if (msg.t === "join") {
          // С аккаунтом имя берётся из сессии: чужим именем не войти.
          session.name = (userName || String(msg.name ?? "")).trim().slice(0, 24);
          room.join(session.name, userId, msg.mode);
          room.players.get(session.name).ws = server;
          room.send(session.name, room.state(session.name));
          if (room.started) room.send(session.name, room.packetFor(session.name));
          return;
        }

        if (!session.name) return fail("not_joined");

        switch (msg.t) {
          case "start": return room.start(session.name);
          case "attach": return room.attach(session.name, msg.clueId);
          case "detach": return room.detach(session.name, msg.clueId);
          case "note": return room.note(session.name, msg.text, msg.secret);
          case "move": return room.move(session.name, msg.id, msg.x, msg.y);
          case "suspect": return room.suspect(session.name, msg.suspectId, msg.on !== false);
          case "chat": return room.say(session.name, msg.text);
          case "ask": await room.ask(session.name, msg.suspectId, msg.text); return;
          case "accuse": return room.accuse(session.name, msg.suspect);
          default: return fail("unknown_type");
        }
      } catch (error) {
        fail(error.message);
      }
    });

    server.addEventListener("close", () => {
      const player = session.name && room.players.get(session.name);
      if (player) player.ws = null;
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}
