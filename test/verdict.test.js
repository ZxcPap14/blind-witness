import test from "node:test";
import assert from "node:assert/strict";
import { judge, rating, DIMS } from "../server/verdict.mjs";

const caseData = {
  culprit: "s3",
  clues: [
    { id: "a", proves: { place: "причал" }, truthful: true },
    { id: "b", proves: { time: "22:40" }, truthful: true },
    { id: "c", proves: { weapon: "трос" }, truthful: true },
    { id: "lie", proves: { place: "маяк", weapon: "нож" }, truthful: false },
    { id: "empty", proves: {}, truthful: true },
  ],
};

test("верный подозреваемый и две линии — победа", () => {
  const result = judge(caseData, { suspect: "s3", evidence: ["a", "b"] });
  assert.equal(result.result, "win");
});

test("верный подозреваемый и одна линия — прокурор возвращает дело", () => {
  const result = judge(caseData, { suspect: "s3", evidence: ["a"] });
  assert.equal(result.result, "retry");
});

test("неверный подозреваемый — поражение даже с полным набором улик", () => {
  const result = judge(caseData, { suspect: "s1", evidence: ["a", "b", "c"] });
  assert.equal(result.result, "loss");
});

test("ложная улика не даёт линий", () => {
  const result = judge(caseData, { suspect: "s3", evidence: ["lie"] });
  assert.equal(result.result, "retry");
});

test("улика без proves не считается", () => {
  const result = judge(caseData, { suspect: "s3", evidence: ["empty", "a"] });
  assert.equal(result.result, "retry");
});

test("несуществующая улика игнорируется", () => {
  const result = judge(caseData, { suspect: "s3", evidence: ["нет-такой", "a", "c"] });
  assert.equal(result.result, "win");
});

test("оценка падает с числом попыток", () => {
  assert.equal(rating(1), "A");
  assert.equal(rating(2), "B");
  assert.equal(rating(4), "C");
});

test("линий ровно три", () => {
  assert.deepEqual(DIMS, ["place", "time", "weapon"]);
});
