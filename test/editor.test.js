import test from "node:test";
import assert from "node:assert/strict";
import { validateCase } from "../server/editor.mjs";
import { loadCase } from "../server/load.mjs";

const good = loadCase(new URL("../cases/lighthouse-01.json", import.meta.url));

const clone = () => structuredClone(good);

test("готовое дело проходит проверку", () => {
  const result = validateCase(good);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("убийца должен быть среди подозреваемых", () => {
  const data = clone();
  data.culprit = "s9";
  const result = validateCase(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("Убийца")));
});

test("каждая линия должна быть закрыта правдивой уликой", () => {
  const data = clone();
  data.clues = data.clues.map((clue) =>
    clue.proves?.weapon ? { ...clue, truthful: false } : clue,
  );
  const result = validateCase(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("weapon")));
});

test("ложных улик не больше трёх", () => {
  const data = clone();
  data.clues = data.clues.map((clue) => ({ ...clue, truthful: false }));
  const result = validateCase(data);
  assert.ok(result.errors.some((error) => error.includes("Ложных улик")));
});

test("роль без документов ломает дело", () => {
  const data = clone();
  data.clues = data.clues.filter((clue) => clue.role !== "autopsy");
  const result = validateCase(data);
  assert.ok(result.errors.some((error) => error.includes("Лекарь")));
});

test("повтор id ловится", () => {
  const data = clone();
  data.clues[1].id = data.clues[0].id;
  const result = validateCase(data);
  assert.ok(result.errors.some((error) => error.includes("повторяется")));
});

test("пустое поле ловится", () => {
  const data = clone();
  data.weapon = "";
  const result = validateCase(data);
  assert.ok(result.errors.some((error) => error.includes("оружие")));
});

test("не объект не проходит", () => {
  assert.equal(validateCase([1, 2]).ok, false);
  assert.equal(validateCase(null).ok, false);
});
