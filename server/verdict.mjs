export const DIMS = ["place", "time", "weapon"];

// Обвинение проверяет только код: имя сравнивается с истиной, улики — с их proves.
export function judge(caseData, { suspect, evidence }) {
  if (suspect !== caseData.culprit) {
    return {
      result: "loss",
      reason: "Не тот человек. Дело закрыто поспешно, настоящий убийца ушёл.",
    };
  }

  const dims = new Set();
  for (const id of evidence) {
    const clue = caseData.clues.find((c) => c.id === id);
    if (!clue || !clue.truthful) continue;
    for (const dim of DIMS) if (clue.proves?.[dim]) dims.add(dim);
  }

  if (dims.size < 2) {
    return {
      result: "retry",
      reason: `Прокурор вернул дело: доказана ${dims.size} линия из 3 (место, время, оружие), нужно минимум 2.`,
    };
  }

  return {
    result: "win",
    reason: `Обвинение принято. Доказано: ${[...dims].join(", ")}.`,
  };
}

export function rating(attempts) {
  if (attempts <= 1) return "A";
  if (attempts === 2) return "B";
  return "C";
}
