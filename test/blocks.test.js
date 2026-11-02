import test from "node:test";
import assert from "node:assert/strict";
import { buildCase, missingDims } from "../server/blocks.mjs";
import { judge } from "../server/verdict.mjs";
import { ALL_ROLES } from "../server/room.mjs";
import { loadCase } from "../server/load.mjs";

const blocks = loadCase(new URL("../cases/blocks/lighthouse.json", import.meta.url));

// Свой генератор случайности: тест не должен зависеть от Math.random.
function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

test("дело из блоков всегда решаемо: все три линии закрыты", () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const caseData = buildCase(blocks, seeded(seed));
    assert.deepEqual(missingDims(caseData), [], `seed ${seed}`);
    assert.ok(caseData.suspects.some((suspect) => suspect.id === caseData.culprit));
  }
});

test("у каждого шаблона подставлены все значения", () => {
  const caseData = buildCase(blocks, seeded(7));
  for (const clue of caseData.clues) {
    assert.ok(!clue.text.includes("{"), clue.text);
    assert.ok(!clue.text.includes("undefined"), clue.text);
  }
});

test("улики есть у всех пяти ролей", () => {
  const caseData = buildCase(blocks, seeded(11));
  const roles = new Set(caseData.clues.map((clue) => clue.role));
  assert.deepEqual([...roles].sort(), [...ALL_ROLES].sort());
});

test("правда выбирается заново: разные зёрна — разные дела", () => {
  const truthOf = (seed) => {
    const caseData = buildCase(blocks, seeded(seed));
    return [caseData.culprit, caseData.place, caseData.timeOfDeath, caseData.weapon].join("|");
  };
  const variants = new Set();
  for (let seed = 1; seed <= 40; seed += 1) variants.add(truthOf(seed));
  assert.ok(variants.size > 5, `вариантов всего ${variants.size}`);
});

test("ложные улики линий не дают, правдивые дают победу", () => {
  const caseData = buildCase(blocks, seeded(3));
  const falseIds = caseData.clues.filter((clue) => !clue.truthful).map((clue) => clue.id);
  const trueIds = caseData.clues.filter((clue) => clue.truthful).map((clue) => clue.id);

  assert.equal(judge(caseData, { suspect: caseData.culprit, evidence: falseIds }).result, "retry");
  assert.equal(judge(caseData, { suspect: caseData.culprit, evidence: trueIds }).result, "win");
});

test("время смерти на полчаса позже нижней границы экспертизы", () => {
  const caseData = buildCase(blocks, seeded(5));
  const autopsy = caseData.clues.find((clue) => clue.text.startsWith("Смерть между"));
  const [, early, late] = autopsy.text.match(/Смерть между (\S+) и (\S+)/);
  const minutes = (time) => {
    const [hours, mins] = time.split(":").map(Number);
    return hours * 60 + mins;
  };
  assert.equal((minutes(late) - minutes(early) + 24 * 60) % (24 * 60), 30);
  assert.equal(late, caseData.timeOfDeath);
});
