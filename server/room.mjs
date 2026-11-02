import { projection } from "./case.mjs";
import { answerBot, polish } from "./bot.mjs";
import { judge, rating } from "./verdict.mjs";

export const CORE_ROLES = ["map", "records", "witness", "autopsy"];
export const EXTRA_ROLE = "archive";
export const ALL_ROLES = [...CORE_ROLES, EXTRA_ROLE];
export const MODES = ["player", "host", "observer"];

// Ведущий и наблюдатель видят всё: им документы не раздаются, а показываются целиком.
const seesAll = (player) => Boolean(player) && player.mode !== "player";

const clamp = (value) => Math.min(0.95, Math.max(0.05, Number(value) || 0.5));

// Одна комната = один объект в памяти. Истина дела живёт в caseData и наружу не уходит.
export class Room {
  constructor(code, caseData, send) {
    this.code = code;
    this.caseData = caseData;
    this.send = send; // (name, message) => void, ставится владельцем комнаты
    this.players = new Map(); // name -> { roles }
    this.started = false;
    this.evidence = new Set();
    this.notes = [];
    this.positions = new Map(); // cardId -> { x, y } в долях доски
    this.suspicion = new Map(); // suspectId -> Set(names)
    this.chat = [];
    this.attempts = 0;
    this.startedAt = null;
    this.pausedAt = null; // момент, когда ведущий поставил паузу
    this.pauseMs = 0; // сколько уже простояли на паузах
    this.finished = null;
    this.noteSeq = 0;
    this.onFinish = null;
    this.persist = null;
  }

  // Плоское состояние без сокетов: годится и для Durable Object storage, и для отладки.
  snapshot() {
    return {
      code: this.code,
      caseId: this.caseData.id,
      players: [...this.players].map(([name, player]) => [
        name,
        { roles: player.roles, userId: player.userId ?? null, mode: player.mode ?? "player" },
      ]),
      evidence: [...this.evidence],
      notes: this.notes,
      positions: [...this.positions],
      suspicion: [...this.suspicion].map(([id, names]) => [id, [...names]]),
      chat: this.chat.slice(-60),
      attempts: this.attempts,
      started: this.started,
      startedAt: this.startedAt,
      pausedAt: this.pausedAt,
      pauseMs: this.pauseMs,
      finished: this.finished,
      noteSeq: this.noteSeq,
    };
  }

  // Восстановление после выгрузки объекта: сокеты приходят заново, их в снимке нет.
  load(data) {
    this.code = data.code ?? this.code;
    for (const [name, player] of data.players ?? []) {
      this.players.set(name, { roles: player.roles ?? [], userId: player.userId ?? null, mode: player.mode ?? "player", ws: null });
    }
    this.evidence = new Set(data.evidence ?? []);
    this.notes = data.notes ?? [];
    this.positions = new Map(data.positions ?? []);
    this.suspicion = new Map((data.suspicion ?? []).map(([id, names]) => [id, new Set(names)]));
    this.chat = data.chat ?? [];
    this.attempts = data.attempts ?? 0;
    this.started = Boolean(data.started);
    this.startedAt = data.startedAt ?? null;
    this.pausedAt = data.pausedAt ?? null;
    this.pauseMs = data.pauseMs ?? 0;
    this.finished = data.finished ?? null;
    this.noteSeq = data.noteSeq ?? 0;
  }

  get host() {
    return [...this.players.keys()][0] ?? null;
  }

  join(name, userId = null, mode = "player") {
    if (!name) throw new Error("need_name");
    if (this.players.has(name)) return this.players.get(name);
    if (this.finished) throw new Error("game_over");
    const clean = MODES.includes(mode) ? mode : "player";
    const playing = [...this.players.values()].filter((player) => player.mode === "player").length;
    if (clean === "player" ? playing >= 5 : this.players.size >= 6) throw new Error("room_full");
    const player = { roles: [], userId, mode: clean };
    this.players.set(name, player);
    const role = clean === "host" ? " ведущим" : clean === "observer" ? " наблюдателем" : "";
    this.chat.push({ from: "—", text: `${name} вошёл в комнату${role}` });
    this.pushState();
    return player;
  }

  // Пакет участника: свои документы игроку, все документы и правда — ведущему.
  packetFor(name) {
    const player = this.players.get(name);
    const packet = {
      t: "welcome",
      roles: player?.roles ?? [],
      mode: player?.mode ?? "player",
      ...projection(this.caseData, seesAll(player) ? ALL_ROLES : player?.roles ?? []),
    };
    if (seesAll(player)) {
      const culprit = this.caseData.suspects.find((s) => s.id === this.caseData.culprit);
      packet.truth = { culprit: this.caseData.culprit, name: culprit?.name ?? this.caseData.culprit };
    }
    return packet;
  }

  start(byName) {
    if (this.started) throw new Error("already_started");
    if (byName !== this.host) throw new Error("not_host");
    const names = [...this.players.keys()].filter((name) => this.players.get(name).mode === "player");
    if (names.length < 2) throw new Error("need_two");

    const roles = [...CORE_ROLES];
    if (names.length >= 5) roles.push(EXTRA_ROLE);

    names.forEach((name, index) => {
      this.players.get(name).roles = roles.filter((_, k) => k % names.length === index);
    });

    this.started = true;
    this.startedAt = Date.now();
    for (const name of this.players.keys()) this.send(name, this.packetFor(name));
    this.pushState();
  }

  // Пауза — инструмент ведущего: таймер стоит, пока компания обсуждает вслух.
  pause(name) {
    if (!this.started) throw new Error("not_started");
    if (this.players.get(name)?.mode !== "host") throw new Error("not_host");
    if (this.pausedAt) {
      this.pauseMs += Date.now() - this.pausedAt;
      this.pausedAt = null;
    } else {
      this.pausedAt = Date.now();
    }
    this.pushState();
  }

  attach(name, clueId) {
    this.ownClue(name, clueId);
    this.evidence.add(clueId);
    this.place(clueId);
    this.pushState();
  }

  detach(name, clueId) {
    this.ownClue(name, clueId);
    this.evidence.delete(clueId);
    this.positions.delete(clueId);
    this.pushState();
  }

  ownClue(name, clueId) {
    if (!this.started) throw new Error("not_started");
    const player = this.players.get(name);
    if (!player) throw new Error("not_joined");
    const clue = this.caseData.clues.find((c) => c.id === clueId);
    // Ведущий открывает на столе любую улику — это его способ подкидывать материал.
    if (!clue || (player.mode !== "host" && !player.roles.includes(clue.role))) throw new Error("not_yours");
    return clue;
  }

  note(name, text, secret = false) {
    if (!this.started) throw new Error("not_started");
    const clean = String(text ?? "").trim().slice(0, 240);
    if (!clean) return;
    this.noteSeq += 1;
    const id = `n${this.noteSeq}`;
    this.notes.push({ id, by: name, text: clean, secret: Boolean(secret) });
    this.place(id);
    this.pushState();
  }

  // Новая карточка не падает в центр поверх других: места раздаются по сетке.
  place(id) {
    if (this.positions.has(id)) return;
    const index = this.positions.size;
    this.positions.set(id, {
      x: 0.18 + (index % 3) * 0.32,
      y: 0.16 + Math.floor(index / 3) * 0.26,
    });
  }

  move(name, id, x, y) {
    if (!this.started) throw new Error("not_started");
    if (!this.players.has(name)) throw new Error("not_joined");
    if (!this.positions.has(id)) this.positions.set(id, { x: 0.5, y: 0.5 });
    const next = { x: clamp(x), y: clamp(y) };
    this.positions.set(id, next);
    // Движение мыши не гоняет весь снапшот: только одну карточку.
    this.broadcast({ t: "moved", id, ...next });
    this.persist?.();
  }

  suspect(name, suspectId, on = true) {
    if (!this.started) throw new Error("not_started");
    if (!this.suspicion.has(suspectId)) this.suspicion.set(suspectId, new Set());
    const marks = this.suspicion.get(suspectId);
    if (on) marks.add(name);
    else marks.delete(name);
    this.pushState();
  }

  async ask(name, suspectId, question) {
    if (!this.started) throw new Error("not_started");
    const suspect = this.caseData.suspects.find((s) => s.id === suspectId);
    if (!suspect) throw new Error("no_suspect");
    const clean = String(question ?? "").trim().slice(0, 200);
    if (!clean) return;

    this.chat.push({ from: name, text: `спрашивает ${suspect.name}: ${clean}` });
    const { text } = answerBot(this.caseData, suspectId, clean);
    this.chat.push({ from: suspect.name, text: await polish(text, clean), bot: true });
    this.pushState();
  }

  say(name, text) {
    if (this.players.get(name)?.mode === "observer") throw new Error("observer_silent");
    const clean = String(text ?? "").trim().slice(0, 400);
    if (!clean) return;
    this.chat.push({ from: name, text: clean });
    this.pushState();
  }

  accuse(name, suspect) {
    if (!this.started) throw new Error("not_started");
    if (this.finished) throw new Error("game_over");
    // Обвинение — дело игроков: ведущий подсказывает, наблюдатель молчит.
    if (this.players.get(name)?.mode !== "player") throw new Error("not_your_call");
    this.attempts += 1;
    const verdict = judge(this.caseData, { suspect, evidence: [...this.evidence] });
    if (verdict.result !== "retry") {
      this.finished = { ...verdict, rating: rating(this.attempts), by: name };
      this.onFinish?.(this.finished);
    }
    this.chat.push({ from: "—", text: `${name} выдвигает обвинение.` });
    this.broadcast({ t: "verdict", suspect, attempts: this.attempts, ...verdict });
    this.pushState();
  }

  cards(viewer) {
    const position = (id) => this.positions.get(id) ?? { x: 0.5, y: 0.5 };
    const clueCards = [...this.evidence].map((id) => {
      const clue = this.caseData.clues.find((c) => c.id === id);
      return { id, type: "clue", role: clue.role, kind: clue.kind, text: clue.text, ...position(id) };
    });
    const noteCards = this.notes.map((note) => {
      const locked = note.secret && note.by !== viewer;
      return {
        id: note.id,
        type: "note",
        by: note.by,
        secret: note.secret,
        locked,
        text: locked ? "" : note.text,
        ...position(note.id),
      };
    });
    return [...clueCards, ...noteCards];
  }

  // Снапшот одинаков по форме, но у каждого игрока свой: приватные заметки скрыты.
  state(viewer) {
    const player = this.players.get(viewer);
    const message = {
      t: "state",
      code: this.code,
      host: this.host,
      started: this.started,
      players: [...this.players].map(([name, item]) => ({
        name,
        roles: item.roles,
        mode: item.mode ?? "player",
      })),
      evidence: [...this.evidence],
      cards: this.started ? this.cards(viewer) : [],
      suspicion: Object.fromEntries([...this.suspicion].map(([id, names]) => [id, [...names]])),
      chat: this.chat.slice(-60),
      attempts: this.attempts,
      startedAt: this.startedAt,
      pausedAt: this.pausedAt,
      pauseMs: this.pauseMs,
      finished: this.finished,
    };
    if (this.started && seesAll(player)) message.truth = this.packetFor(viewer).truth;
    return message;
  }

  broadcast(message) {
    for (const name of this.players.keys()) this.send(name, message);
  }

  pushState() {
    this.persist?.();
    for (const name of this.players.keys()) this.send(name, this.state(name));
  }
}
