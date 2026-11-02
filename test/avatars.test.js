import test from "node:test";
import assert from "node:assert/strict";
import { AVATAR_LIMIT, nameKey, sniffImage } from "../server/avatars.mjs";

const bytes = (...values) => new Uint8Array([...values, ...Array(16).fill(0)]);

test("png, jpeg и webp узнаются по первым байтам", () => {
  assert.equal(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47)).mime, "image/png");
  assert.equal(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0)).mime, "image/jpeg");
  const webp = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
  assert.equal(sniffImage(webp).mime, "image/webp");
});

test("svg, gif и мусор не проходят", () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
  assert.equal(sniffImage(svg), null);
  assert.equal(sniffImage(bytes(0x47, 0x49, 0x46, 0x38)), null);
  assert.equal(sniffImage(new Uint8Array()), null);
  assert.equal(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20)), null);
});

test("предел размера и ключ имени", () => {
  assert.equal(AVATAR_LIMIT, 200 * 1024);
  assert.equal(nameKey("  Вера  "), "вера");
});
