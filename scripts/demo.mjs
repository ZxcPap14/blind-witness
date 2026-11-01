// Заполняет комнату для проверки вида: два игрока, начало дела, карточки на столе.
// Запуск: node scripts/demo.mjs   (сервер должен работать на PORT, по умолчанию 8080)
import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 8080);
const CODE = process.env.ROOM ?? "demo";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
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

anya.send({ t: "start" });
await sleep(200);

// При двух игроках Аня получает картографа и очевидца, Боря — писаря и лекаря.
for (const clueId of ["c1", "c2", "c7"]) anya.send({ t: "attach", clueId });
for (const clueId of ["c5", "c10"]) boris.send({ t: "attach", clueId });
await sleep(200);

anya.send({ t: "note", text: "Человек в дождевике у причала — искать среди моряков" });
boris.send({ t: "note", text: "Счёт закрыт в 21:50, алиби Крюка рвётся" });
anya.send({ t: "note", text: "Страховка на 20 000 в пользу брата", secret: true });
await sleep(200);

anya.send({ t: "suspect", suspectId: "s3", on: true });
boris.send({ t: "suspect", suspectId: "s3", on: true });
anya.send({ t: "chat", text: "Крюк хромает — примета сходится, прикладывайте время смерти" });
boris.send({ t: "chat", text: "Смерть 22:30–22:50, значит он успевал" });
anya.send({ t: "ask", suspectId: "s3", text: "Где ты был в 22:40 вечером?" });
anya.send({ t: "ask", suspectId: "s2", text: "Крюк сидел у тебя в таверне?" });
await sleep(400);

console.log(`http://localhost:${PORT}/#room=${CODE}&name=${encodeURIComponent("Аня")}`);
anya.ws.close();
boris.ws.close();
