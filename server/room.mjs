import { projection } from "./case.mjs";
import { answerBot, polish } from "./bot.mjs";
import { judge, rating } from "./verdict.mjs";

export const CORE_ROLES = ["map", "records", "witness", "autopsy"];
export const EXTRA_ROLE = "archive";

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
    this.finished = null;
    this.noteSeq = 0;
    this.onFinish = null;
  }

  get host() {
    return [...this.players.keys()][0] ?? null;
  }

  join(name, userId = null) {
    if (!name) throw new Error("need_name");
    if (this.players.has(name)) return this.players.get(name);
    if (this.finished) throw new Error("game_over");
    if (this.players.size >= 5) throw new Error("room_full");
    const player = { roles: [], userId };
    this.players.set(name, player);
    this.chat.push({ from: "—", text: `${name} вошёл в комнату` });
    this.pushState();
    return player;
  }

  start(byName) {
    if (this.started) throw new Error("already_started");
    if (byName !== this.host) throw new Error("not_host");
    const names = [...this.players.keys()];
    if (names.length < 2) throw new Error("need_two");

    const roles = [...CORE_ROLES];
    if (names.length >= 5) roles.push(EXTRA_ROLE);

    names.forEach((name, index) => {
      const player = this.players.get(name);
      player.roles = roles.filter((_, k) => k % names.length === index);
      this.send(name, {
        t: "welcome",
        roles: player.roles,
        ...projection(this.caseData, player.roles),
      });
    });

    this.started = true;
    this.startedAt = Date.now();
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
    const clue = this.caseData.clues.find((c) => c.id === clueId);
    if (!clue || !this.players.get(name).roles.includes(clue.role)) throw new Error("not_yours");
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
    const clean = String(text ?? "").trim().slice(0, 400);
    if (!clean) return;
    this.chat.push({ from: name, text: clean });
    this.pushState();
  }

  accuse(name, suspect) {
    if (!this.started) throw new Error("not_started");
    if (this.finished) throw new Error("game_over");
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
    return {
      t: "state",
      code: this.code,
      host: this.host,
      started: this.started,
      players: [...this.players.keys()].map((name) => ({
        name,
        roles: this.players.get(name).roles,
      })),
      evidence: [...this.evidence],
      cards: this.started ? this.cards(viewer) : [],
      suspicion: Object.fromEntries([...this.suspicion].map(([id, names]) => [id, [...names]])),
      chat: this.chat.slice(-60),
      attempts: this.attempts,
      startedAt: this.startedAt,
      finished: this.finished,
    };
  }

  broadcast(message) {
    for (const name of this.players.keys()) this.send(name, message);
  }

  pushState() {
    for (const name of this.players.keys()) this.send(name, this.state(name));
  }
}
