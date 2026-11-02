import { DIMS } from "./verdict.mjs";

const pick = (list, random) => list[Math.floor(random() * list.length)];

// «22:40» минус полчаса → «22:10»; через полночь время переезжает на сутки назад.
function shift(time, minutes) {
  const [hours, mins] = String(time).split(":").map(Number);
  const total = (hours * 60 + mins - minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Улики собираются по шаблонам: подстановка убийцы, места, времени и оружия.
export function buildCase(blocks, random = Math.random) {
  const culprit = pick(blocks.suspects, random);
  const place = pick(blocks.places, random);
  const time = pick(blocks.times, random);
  const weapon = pick(blocks.weapons, random);

  const truth = {
    culprit: culprit.name,
    place,
    time,
    early: shift(time, 30),
    weapon,
  };
  const truthOf = { place: place.name, time, weapon: weapon.name, suspect: culprit.id };

  const fill = (text) =>
    text.replace(/\{(\w+)(?:\.(\w+))?\}/g, (_, key, field) => {
      const value = truth[key];
      if (value === undefined) return "";
      return field ? String(value[field] ?? "") : String(value);
    });

  const clues = blocks.templates.map((template, index) => {
    const proves = {};
    for (const dim of template.proves ?? []) proves[dim] = truthOf[dim];
    return {
      id: `c${index + 1}`,
      role: template.role,
      kind: template.kind,
      text: fill(template.text),
      proves,
      truthful: template.truthful !== false,
    };
  });

  return {
    id: blocks.id,
    title: blocks.title,
    victim: blocks.victim,
    culprit: culprit.id,
    place: place.name,
    timeOfDeath: time,
    weapon: weapon.name,
    suspects: blocks.suspects,
    clues,
    generated: true,
  };
}

// Проверка сборки: дело решаемо, только если каждая линия закрыта правдивой уликой.
export function missingDims(caseData) {
  const covered = new Set();
  for (const clue of caseData.clues) {
    if (!clue.truthful) continue;
    for (const dim of DIMS) if (clue.proves?.[dim]) covered.add(dim);
  }
  return DIMS.filter((dim) => !covered.has(dim));
}
