import test from "node:test";
import assert from "node:assert/strict";
import { loadCase, projection } from "../server/load.mjs";

const caseData = loadCase(new URL("../cases/lighthouse-01.json", import.meta.url));

test("проекция содержит только улики своих ролей", () => {
  const view = projection(caseData, ["witness"]);
  assert.ok(view.clues.length > 0);
  assert.ok(view.clues.every((clue) => clue.role === "witness"));
});

test("проекция нескольких ролей складывает пакеты", () => {
  const view = projection(caseData, ["map", "autopsy"]);
  const roles = new Set(view.clues.map((clue) => clue.role));
  assert.deepEqual([...roles].sort(), ["autopsy", "map"]);
});

test("в проекции нет истины: proves, truthful, culprit", () => {
  for (const role of ["map", "records", "witness", "autopsy", "archive"]) {
    const raw = JSON.stringify(projection(caseData, [role]));
    assert.ok(!raw.includes("proves"), `proves утекло в роль ${role}`);
    assert.ok(!raw.includes("truthful"), `truthful утекло в роль ${role}`);
    assert.ok(!raw.includes("culprit"), `culprit утекло в роль ${role}`);
  }
});

test("каждая роль получает хотя бы один документ", () => {
  for (const role of ["map", "records", "witness", "autopsy", "archive"]) {
    assert.ok(projection(caseData, [role]).clues.length > 0, `пустая роль ${role}`);
  }
});
