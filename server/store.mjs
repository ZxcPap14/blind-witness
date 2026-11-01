import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

const hashPassword = (password, salt = randomBytes(16).toString("hex")) =>
  `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;

function passwordMatches(password, stored) {
  const [salt, digest] = String(stored).split(":");
  const expected = Buffer.from(digest ?? "", "hex");
  const actual = scryptSync(password, salt ?? "", 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Аккаунты, сессии и таблица компании. Хранилище — встроенный SQLite, без зависимостей.
export class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        key TEXT UNIQUE NOT NULL,
        pass TEXT NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stats (
        user_id INTEGER PRIMARY KEY,
        games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  register(name, password) {
    const clean = String(name ?? "").trim().slice(0, 24);
    if (clean.length < 2) throw new Error("bad_name");
    if (String(password ?? "").length < 6) throw new Error("weak_password");
    // SQLite NOCASE не знает кириллицы, поэтому сравнение по нормализованному ключу.
    const key = clean.toLowerCase();
    if (this.db.prepare("SELECT id FROM users WHERE key = ?").get(key)) throw new Error("name_taken");
    const info = this.db
      .prepare("INSERT INTO users (name, key, pass, created) VALUES (?, ?, ?, ?)")
      .run(clean, key, hashPassword(password), Date.now());
    return { id: Number(info.lastInsertRowid), name: clean };
  }

  login(name, password) {
    const row = this.db
      .prepare("SELECT id, name, pass FROM users WHERE key = ?")
      .get(String(name ?? "").trim().toLowerCase());
    if (!row || !passwordMatches(String(password ?? ""), row.pass)) throw new Error("bad_credentials");
    return { id: row.id, name: row.name };
  }

  createSession(userId) {
    const token = randomBytes(24).toString("hex");
    this.db
      .prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)")
      .run(token, userId, Date.now() + SESSION_TTL);
    return token;
  }

  userByToken(token) {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT s.user_id AS id, u.name AS name, s.expires AS expires
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
      )
      .get(token);
    if (!row) return null;
    if (row.expires < Date.now()) {
      this.destroySession(token);
      return null;
    }
    return { id: row.id, name: row.name };
  }

  destroySession(token) {
    if (token) this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }

  finish(userId, win) {
    this.db
      .prepare(
        `INSERT INTO stats (user_id, games, wins) VALUES (?, 1, ?)
         ON CONFLICT(user_id) DO UPDATE SET games = games + 1, wins = wins + excluded.wins`,
      )
      .run(userId, win ? 1 : 0);
  }

  stats(userId) {
    const row = this.db.prepare("SELECT games, wins FROM stats WHERE user_id = ?").get(userId);
    return { games: row?.games ?? 0, wins: row?.wins ?? 0 };
  }

  leaderboard(limit = 10) {
    return this.db
      .prepare(
        `SELECT u.name AS name, s.games AS games, s.wins AS wins
         FROM stats s JOIN users u ON u.id = s.user_id
         ORDER BY s.wins DESC, s.games ASC LIMIT ?`,
      )
      .all(limit);
  }
}
