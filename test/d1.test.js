import test from "node:test";
import assert from "node:assert";
import { hashPassword, passwordMatches } from "../worker/d1.mjs";

test("пароль проверяется, а чужой — нет", async () => {
  const stored = await hashPassword("секрет1");
  assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(await passwordMatches("секрет1", stored), true);
  assert.equal(await passwordMatches("секрет2", stored), false);
});

test("одинаковая соль даёт тот же хеш, случайная — другой", async () => {
  const salt = "00112233445566778899aabbccddeeff";
  assert.equal(await hashPassword("пароль", salt), await hashPassword("пароль", salt));
  assert.notEqual(await hashPassword("пароль", salt), await hashPassword("пароль"));
});

test("битая строка хеша не пускает", async () => {
  assert.equal(await passwordMatches("x", ""), false);
  assert.equal(await passwordMatches("x", "без двоеточия"), false);
});
