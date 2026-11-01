export const ROLES = ["map", "records", "witness", "autopsy", "archive"];
export const CORE_ROLES = ["map", "records", "witness", "autopsy"];
export const DIMS = ["place", "time", "weapon"];

const ROLE_NAMES = {
  map: "Штурман",
  records: "Писарь",
  witness: "Очевидец",
  autopsy: "Лекарь",
  archive: "Архивист",
};

const isText = (value) => typeof value === "string" && value.trim().length > 0;

// Дело валидно, если его можно сыграть: убийца среди подозреваемых, каждая линия
// закрыта правдивой уликой, у каждой роли есть документы, врут не больше трёх улик.
export function validateCase(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["Это не объект JSON"] };
  }

  const errors = [];

  for (const [field, label] of [
    ["id", "id дела"],
    ["title", "название"],
    ["victim", "жертва"],
    ["place", "место"],
    ["timeOfDeath", "время смерти"],
    ["weapon", "оружие"],
  ]) {
    if (!isText(data[field])) errors.push(`Не заполнено поле «${label}»`);
  }

  const suspects = Array.isArray(data.suspects) ? data.suspects : [];
  if (suspects.length < 2) {
    errors.push("Нужно минимум двое подозреваемых");
  } else {
    const ids = new Set();
    for (const suspect of suspects) {
      if (!isText(suspect?.id) || !isText(suspect?.name)) {
        errors.push("У подозреваемого нет id или имени");
        continue;
      }
      if (ids.has(suspect.id)) errors.push(`id подозреваемого «${suspect.id}» повторяется`);
      ids.add(suspect.id);
    }
    if (!ids.has(data.culprit)) errors.push("Убийца не выбран среди подозреваемых");
  }

  const clues = Array.isArray(data.clues) ? data.clues : [];
  if (clues.length < 4) {
    errors.push("Нужно хотя бы четыре улики");
  } else {
    const seen = new Set();
    const covered = { place: false, time: false, weapon: false };
    const rolesWithClues = new Set();
    let lies = 0;

    for (const clue of clues) {
      if (!isText(clue?.id) || !isText(clue?.text)) {
        errors.push("У улики нет id или текста");
        continue;
      }
      if (seen.has(clue.id)) errors.push(`id улики «${clue.id}» повторяется`);
      seen.add(clue.id);

      if (!ROLES.includes(clue.role)) {
        errors.push(`У улики «${clue.id}» неизвестная роль «${clue.role}»`);
      } else {
        rolesWithClues.add(clue.role);
      }

      if (typeof clue.truthful !== "boolean") {
        errors.push(`У улики «${clue.id}» не указано truthful`);
      } else if (!clue.truthful) {
        lies += 1;
      } else {
        for (const dim of DIMS) if (clue.proves?.[dim]) covered[dim] = true;
      }
    }

    if (lies > 3) errors.push(`Ложных улик ${lies}, а максимум 3`);
    for (const dim of DIMS) {
      if (!covered[dim]) errors.push(`Ни одна правдивая улика не доказывает линию «${dim}»`);
    }
    for (const role of CORE_ROLES) {
      if (!rolesWithClues.has(role)) errors.push(`У роли «${ROLE_NAMES[role]}» нет ни одной улики`);
    }
  }

  return { ok: errors.length === 0, errors };
}
