// Заполняет комнату для проверки вида: два игрока, начало дела, карточки на столе.
// Запуск: node scripts/demo.mjs            (локально, http://127.0.0.1:PORT)
//         BASE=https://... node scripts/demo.mjs   (прод, Cloudflare)
import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 8080);
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CODE = process.env.ROOM ?? "demo";
const CASE = process.env.CASE ?? "";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect() {
  const query = `room=${CODE}${CASE ? `&case=${CASE}` : ""}`;
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws?${query}`);
  const send = (message) => ws.send(JSON.stringify({ ...message, code: CODE }));
  const ready = new Promise((resolve) => ws.on("open", resolve));
  return { ws, send, ready };
}

const anya = connect();
const boris = connect();
await Promise.all([anya.ready, boris.ready]);

anya.send({ t: "join", name: "Аня" });
boris.send({ t: "join", name: "Боря" });
await sleep(200);

// Хост — тот, кто вошёл первым, а порядок входа зависит от гонки: старт шлют оба, сервер примет один.
for (const client of [anya, boris]) client.send({ t: "start" });
await sleep(200);

// При двух игроках роли делятся 2+2, кто именно кем станет — решает порядок в комнате.
// Поэтому каждый документ прикладывают оба: чужой сервер отвергнет, владелец приложит.
for (const clueId of ["c1", "c2", "c5", "c7", "c10", "c11"]) {
  for (const client of [anya, boris]) client.send({ t: "attach", clueId });
}
await sleep(200);

anya.send({ t: "note", text: "Искать того, кто не может подтвердить алиби" });
boris.send({ t: "note", text: "Время смерти сужает круг — сверяйте отметки" });
anya.send({ t: "note", text: "Мотив есть у двоих, проверяем связи", secret: true });
await sleep(200);

anya.send({ t: "suspect", suspectId: "s3", on: true });
boris.send({ t: "suspect", suspectId: "s3", on: true });
anya.send({ t: "chat", text: "Примета сходится со свидетелем, прикладывайте время смерти" });
boris.send({ t: "chat", text: "Смерть точно до выхода — значит успевал" });
anya.send({ t: "ask", suspectId: "s3", text: "Где ты был в 22:40 вечером?" });
anya.send({ t: "ask", suspectId: "s2", text: "Крюк сидел у тебя в таверне?" });
await sleep(400);

console.log(`${BASE}/#room=${CODE}${CASE ? `&case=${CASE}` : ""}&name=${encodeURIComponent("Аня")}`);
anya.ws.close();
boris.ws.close();
