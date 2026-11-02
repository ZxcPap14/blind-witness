// Клиент получает только текст своих ролей: ни proves, ни truthful, ни culprit.
export function projection(caseData, roles) {
  return {
    title: caseData.title,
    victim: caseData.victim,
    suspects: caseData.suspects.map(({ id, name, about }) => ({ id, name, about })),
    clues: caseData.clues
      .filter((c) => roles.includes(c.role))
      .map(({ id, role, kind, text }) => ({ id, role, kind, text })),
  };
}
