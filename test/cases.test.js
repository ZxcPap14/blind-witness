import test from "node:test";
import assert from "node:assert/strict";
import { loadCases } from "../server/case.mjs";
import { validateCase } from "../server/editor.mjs";

const cases = loadCases(new URL("../cases", import.meta.url));

test("в папке ровно три дела", () => {
  assert.equal(cases.length, 3);
});

test("каждое дело проходит валидатор движка", () => {
  for (const item of cases) {
    const result = validateCase(item);
    assert.equal(result.ok, true, `${item.id}: ${result.errors.join("; ")}`);
  }
});

test("у каждого свидетеля есть факты для бота", () => {
  for (const item of cases) {
    for (const suspect of item.suspects) {
      assert.ok(Array.isArray(suspect.facts) && suspect.facts.length >= 3, `${item.id}/${suspect.id}`);
    }
  }
});

test("id дел не повторяются", () => {
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
});
