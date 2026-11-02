// Выдвигает обвинение от лица игрока и печатает вердикт.
// Запуск: BASE=https://... ROOM=prod2 SUSPECT=s3 NAME=Аня node scripts/verdict.mjs
import WebSocket from "ws";

const BASE = process.env.BASE ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`;
const CODE = process.env.ROOM ?? "demo";
const NAME = process.env.NAME ?? "Аня";
const SUSPECT = process.env.SUSPECT ?? "s3";
const CASE = process.env.CASE;

const url = new URL(`${BASE.replace(/^http/, "ws")}/ws`);
url.searchParams.set("room", CODE);
if (CASE) url.searchParams.set("case", CASE);

const socket = new WebSocket(url);
socket.on("open", () => {
  socket.send(JSON.stringify({ t: "join", name: NAME, code: CODE }));
  setTimeout(() => socket.send(JSON.stringify({ t: "accuse", suspect: SUSPECT, code: CODE })), 500);
});
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.t === "verdict") {
    console.log(`${message.result}: ${message.reason}`);
    socket.close();
  }
  if (message.t === "error") {
    console.log(`ошибка: ${message.code}`);
    socket.close();
  }
});
setTimeout(() => {
  console.log("вердикта не было");
  socket.close();
}, 8000);
