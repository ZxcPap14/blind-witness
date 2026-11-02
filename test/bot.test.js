import test from "node:test";
import assert from "node:assert/strict";
import { answerBot } from "../server/bot.mjs";
import { loadCase, projection } from "../server/load.mjs";

const caseData = loadCase(new URL("../cases/lighthouse-01.json", import.meta.url));

test("ответ берётся из фактов свидетеля", () => {
  const { text } = answerBot(caseData, "s3", "где ты был вечером на причале?");
  const facts = caseData.suspects.find((s) => s.id === "s3").facts;
  assert.ok(facts.includes(text), `ответ не из фактов: ${text}`);
});

test("вопрос про алиби попадает в факт про алиби", () => {
  const { text } = answerBot(caseData, "s2", "Крюк сидел у тебя в таверне?");
  assert.match(text, /Крюк сидел|22:40/);
});

test("незнакомый вопрос получает отказ, а не выдумку", () => {
  const { text, fact } = answerBot(caseData, "s1", "какого цвета небо в среду");
  assert.equal(fact, null);
  assert.match(text, /уже всё сказал|Не понимаю|по делу/);
});

test("на каждый факт можно спросить и получить его же", () => {
  for (const suspect of caseData.suspects) {
    for (const fact of suspect.facts) {
      const { text } = answerBot(caseData, suspect.id, fact);
      assert.equal(text, fact);
    }
  }
});

test("свидетель без фактов только отмалчивается", () => {
  const bare = { suspects: [{ id: "x", name: "Молчун" }] };
  assert.equal(answerBot(bare, "x", "что случилось").fact, null);
  assert.throws(() => answerBot(bare, "нет", "что случилось"), /no_suspect/);
});

test("факты свидетелей не попадают в проекцию игроку", () => {
  for (const role of ["map", "records", "witness", "autopsy", "archive"]) {
    const raw = JSON.stringify(projection(caseData, [role]));
    assert.ok(!raw.includes("facts"), `facts утекли в роль ${role}`);
    const firstFact = caseData.suspects[0].facts[0].slice(0, 30);
    assert.ok(!raw.includes(firstFact), `текст факта утёк в роль ${role}`);
  }
});
