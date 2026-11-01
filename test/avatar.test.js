import test from "node:test";
import assert from "node:assert/strict";
import { spriteSignature } from "../client/avatar.js";

// avatar.js трогает DOM только в createAvatar, генератор спрайта — чистый.

test("одно и то же имя даёт одно и то же лицо", () => {
  assert.equal(spriteSignature("s1"), spriteSignature("s1"));
  assert.equal(spriteSignature("Аня"), spriteSignature("Аня"));
});

test("разные имена дают разные лица", () => {
  const seeds = ["s1", "s2", "s3", "s4", "s5", "s6"];
  const signatures = new Set(seeds.map(spriteSignature));
  assert.equal(signatures.size, seeds.length);
});

test("спрайт полностью заполнен по размеру слоя", () => {
  assert.equal(spriteSignature("s1").length, 16 * 16 * 3 * 2 + 1);
});
