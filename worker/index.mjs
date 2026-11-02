import { Room } from "../server/room.mjs";
import { projection } from "../server/case.mjs";
import lighthouse from "../cases/lighthouse-01.json";
import theatre from "../cases/theatre-02.json";
import sosny from "../cases/sosny-03.json";

const CASES = [lighthouse, theatre, sosny];
const pickCase = (id) => (id && CASES.find((item) => item.id === id)) || CASES[Math.floor(Math.random() * CASES.length)];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const code = (url.searchParams.get("room") || "default").slice(0, 16);
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }

    if (url.pathname === "/api/me") return json({ user: null });
    if (url.pathname === "/api/leaderboard") return json({ rows: [] });
    if (url.pathname.startsWith("/api/")) return json({ error: "На проде аккаунты пока выключены" }, 501);

    return env.ASSETS.fetch(request);
  },
};

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
          session.name = String(msg.name ?? "").trim().slice(0, 24);
          room.join(session.name);
          room.players.get(session.name).ws = server;
          room.send(session.name, room.state(session.name));
          if (room.started) {
            room.send(session.name, {
              t: "welcome",
              roles: room.players.get(session.name).roles,
              ...projection(room.caseData, room.players.get(session.name).roles),
            });
          }
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
