// Свидетель отвечает только своими заранее нарезанными фактами.
// Модель (если настроена) может переформулировать, но не добавить нового.
const DEFLECTIONS = [
  "Я уже всё сказал.",
  "Не понимаю, о чём вы.",
  "Спросите что-нибудь по делу.",
];

// Грубый стемминг: «причале» и «причал» должны считаться одним словом.
const stem = (word) => (word.length > 5 ? word.slice(0, 5) : word);

const words = (text) =>
  String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4)
    .map(stem);

function pick(list, seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return list[Math.abs(hash) % list.length];
}

export function answerBot(caseData, suspectId, question) {
  const suspect = caseData.suspects.find((s) => s.id === suspectId);
  if (!suspect) throw new Error("no_suspect");
  const facts = suspect.facts ?? [];
  if (!facts.length) return { text: pick(DEFLECTIONS, suspectId), fact: null };

  const asked = new Set(words(question));
  let best = null;
  let bestScore = 0;

  for (const fact of facts) {
    let score = 0;
    for (const word of words(fact)) if (asked.has(word)) score += 1;
    if (score > bestScore) {
      best = fact;
      bestScore = score;
    }
  }

  if (!best) return { text: pick(DEFLECTIONS, suspectId + question.length), fact: null };
  return { text: best, fact: best };
}

// Необязательный слой: AI_URL + AI_KEY в окружении. Любая ошибка — молча отдаём факт как есть.
export async function polish(text, question) {
  const url = process.env.AI_URL;
  const key = process.env.AI_KEY;
  if (!url || !key) return text;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? "deepseek-v4.1-flash",
        temperature: 0.6,
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content:
              "Ты персонаж детективной игры. Перескажи факт своими словами, одной-двумя фразами, " +
              "не добавляй новых обстоятельств, не называй себя виновным, говори в характере.",
          },
          { role: "user", content: `Вопрос: ${question}\nФакт: ${text}` },
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return text;
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}
