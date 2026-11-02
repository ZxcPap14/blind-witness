// Аккаунты, сессии и таблица компании в D1. Повторяет server/store.mjs,
// но на WebCrypto: в Workers нет node:crypto.

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const ITERATIONS = 100000;

const encoder = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const bytes = (text) => new Uint8Array(text.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? []);

const randomHex = (length) => hex(crypto.getRandomValues(new Uint8Array(length)));

function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function digest(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: bytes(salt), iterations: ITERATIONS },
    key,
    256,
  );
  return hex(bits);
}

export async function hashPassword(password, salt = randomHex(16)) {
  return `${salt}:${await digest(password, salt)}`;
}

export async function passwordMatches(password, stored) {
  const [salt] = String(stored).split(":");
  if (!salt) return false;
  return same(await hashPassword(password, salt), String(stored));
}

export class D1Store {
  constructor(db) {
    this.db = db;
  }

  async register(name, password) {
    const clean = String(name ?? "").trim().slice(0, 24);
    if (clean.length < 2) throw new Error("bad_name");
    if (String(password ?? "").length < 6) throw new Error("weak_password");
    // SQLite NOCASE не знает кириллицы, поэтому сравнение по нормализованному ключу.
    const key = clean.toLowerCase();
    if (await this.db.prepare("SELECT id FROM users WHERE key = ?").bind(key).first()) throw new Error("name_taken");
    const info = await this.db
      .prepare("INSERT INTO users (name, key, pass, created) VALUES (?, ?, ?, ?)")
      .bind(clean, key, await hashPassword(password), Date.now())
      .run();
    return { id: info.meta.last_row_id, name: clean };
  }

  async login(name, password) {
    const row = await this.db
      .prepare("SELECT id, name, pass FROM users WHERE key = ?")
      .bind(String(name ?? "").trim().toLowerCase())
      .first();
    if (!row || !(await passwordMatches(String(password ?? ""), row.pass))) throw new Error("bad_credentials");
    return { id: row.id, name: row.name };
  }

  async createSession(userId) {
    const token = randomHex(24);
    await this.db
      .prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)")
      .bind(token, userId, Date.now() + SESSION_TTL)
      .run();
    return token;
  }

  async userByToken(token) {
    if (!token) return null;
    const row = await this.db
      .prepare(
        `SELECT s.user_id AS id, u.name AS name, s.expires AS expires
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
      )
      .bind(token)
      .first();
    if (!row) return null;
    if (row.expires < Date.now()) {
      await this.destroySession(token);
      return null;
    }
    return { id: row.id, name: row.name };
  }

  async destroySession(token) {
    if (token) await this.db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }

  async finish(userId, win) {
    await this.db
      .prepare(
        `INSERT INTO stats (user_id, games, wins) VALUES (?, 1, ?)
         ON CONFLICT(user_id) DO UPDATE SET games = games + 1, wins = wins + excluded.wins`,
      )
      .bind(userId, win ? 1 : 0)
      .run();
  }

  async stats(userId) {
    const row = await this.db.prepare("SELECT games, wins FROM stats WHERE user_id = ?").bind(userId).first();
    return { games: row?.games ?? 0, wins: row?.wins ?? 0 };
  }

  async leaderboard(limit = 10) {
    const { results } = await this.db
      .prepare(
        `SELECT u.name AS name, s.games AS games, s.wins AS wins
         FROM stats s JOIN users u ON u.id = s.user_id
         ORDER BY s.wins DESC, s.games ASC LIMIT ?`,
      )
      .bind(limit)
      .all();
    return results;
  }
}
