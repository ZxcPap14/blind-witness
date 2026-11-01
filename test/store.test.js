import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";

const fresh = () => new Store(":memory:");

test("пароль не хранится открытым текстом", () => {
  const store = fresh();
  store.register("Аня", "тайна123");
  const row = store.db.prepare("SELECT pass FROM users WHERE name = ?").get("Аня");
  assert.ok(!row.pass.includes("тайна123"));
  assert.match(row.pass, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
});

test("вход с верным и неверным паролем", () => {
  const store = fresh();
  store.register("Аня", "тайна123");
  assert.equal(store.login("Аня", "тайна123").name, "Аня");
  assert.throws(() => store.login("Аня", "не тот"), /bad_credentials/);
  assert.throws(() => store.login("Боря", "тайна123"), /bad_credentials/);
});

test("имя не повторяется, регистр не важен", () => {
  const store = fresh();
  store.register("Аня", "тайна123");
  assert.throws(() => store.register("аня", "другая123"), /name_taken/);
});

test("короткое имя и слабый пароль отвергаются", () => {
  const store = fresh();
  assert.throws(() => store.register("А", "тайна123"), /bad_name/);
  assert.throws(() => store.register("Аня", "123"), /weak_password/);
});

test("сессия находит пользователя и умирает после выхода", () => {
  const store = fresh();
  const user = store.register("Аня", "тайна123");
  const token = store.createSession(user.id);
  assert.equal(store.userByToken(token).name, "Аня");
  store.destroySession(token);
  assert.equal(store.userByToken(token), null);
  assert.equal(store.userByToken("мусор"), null);
});

test("просроченная сессия не работает", () => {
  const store = fresh();
  const user = store.register("Аня", "тайна123");
  const token = store.createSession(user.id);
  store.db.prepare("UPDATE sessions SET expires = ? WHERE token = ?").run(Date.now() - 1000, token);
  assert.equal(store.userByToken(token), null);
});

test("статистика считает дела и победы", () => {
  const store = fresh();
  const user = store.register("Аня", "тайна123");
  store.finish(user.id, true);
  store.finish(user.id, false);
  store.finish(user.id, true);
  assert.deepEqual(store.stats(user.id), { games: 3, wins: 2 });
});

test("таблица компании сортируется по победам", () => {
  const store = fresh();
  const a = store.register("Аня", "тайна123");
  const b = store.register("Боря", "тайна123");
  store.finish(a.id, true);
  store.finish(a.id, false);
  store.finish(b.id, false);
  const rows = store.leaderboard();
  assert.equal(rows[0].name, "Аня");
  assert.equal(rows[0].wins, 1);
  assert.equal(rows[1].name, "Боря");
});
