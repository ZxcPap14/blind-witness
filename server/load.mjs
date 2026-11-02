import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pathOf = (dir) => (dir instanceof URL ? fileURLToPath(dir) : String(dir));

export function loadCase(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// Все дела из папки: комнате достаётся случайное.
export function loadCases(dir) {
  const root = pathOf(dir);
  return readdirSync(root)
    .filter((file) => file.endsWith(".json"))
    .map((file) => loadCase(join(root, file)));
}

export { projection } from "./case.mjs";
