import test from "node:test";
import assert from "node:assert/strict";
import { Room, CORE_ROLES } from "../server/room.mjs";
import { loadCase } from "../server/load.mjs";

const caseData = loadCase(new URL("../cases/lighthouse-01.json", import.meta.url));

function makeRoom(players) {
  const sent = [];
  const room = new Room("test", caseData, (name, message) => sent.push({ name, message }));
  for (const name of players) room.join(name);
  return { room, sent };
}

test("на двоих все четыре роли распределены без потерь", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  const roles = [...room.players.values()].flatMap((player) => player.roles).sort();
  assert.deepEqual(roles, [...CORE_ROLES].sort());
});

test("пятый игрок получает архив", () => {
  const { room } = makeRoom(["1", "2", "3", "4", "5"]);
  room.start("1");
  const roles = [...room.players.values()].flatMap((player) => player.roles);
  assert.ok(roles.includes("archive"));
  assert.deepEqual(roles.sort(), [...CORE_ROLES, "archive"].sort());
});

test("начинать может только создатель комнаты", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  assert.throws(() => room.start("Боря"), /not_host/);
});

test("одному начинать нельзя", () => {
  const { room } = makeRoom(["Аня"]);
  assert.throws(() => room.start("Аня"), /need_two/);
});

test("нельзя приложить чужой документ", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  const foreign = caseData.clues.find((clue) => !room.players.get("Аня").roles.includes(clue.role));
  assert.throws(() => room.attach("Аня", foreign.id), /not_yours/);
});

test("приложенный документ становится карточкой стола с текстом", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  const own = caseData.clues.find((clue) => room.players.get("Аня").roles.includes(clue.role));
  room.attach("Аня", own.id);
  const cards = room.state("Аня").cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0].text, own.text);
  assert.equal(cards[0].proves, undefined);
});

test("заметка появляется карточкой и двигается", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  room.note("Аня", "Крюк хромает");
  const card = room.state("Аня").cards.at(-1);
  assert.equal(card.type, "note");
  room.move("Аня", card.id, 0.2, 0.8);
  const moved = room.state("Аня").cards.at(-1);
  assert.deepEqual([moved.x, moved.y], [0.2, 0.8]);
});

test("координаты карточки зажимаются в пределы доски", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  room.note("Аня", "x");
  const id = room.state("Аня").cards.at(-1).id;
  room.move("Аня", id, -3, 42);
  const card = room.state("Аня").cards.at(-1);
  assert.deepEqual([card.x, card.y], [0.05, 0.95]);
});

test("приватная заметка скрыта от остальных", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  room.note("Аня", "Аркадий врёт", true);
  const mine = room.state("Аня").cards.at(-1);
  const others = room.state("Боря").cards.at(-1);
  assert.equal(mine.text, "Аркадий врёт");
  assert.equal(mine.locked, false);
  assert.equal(others.locked, true);
  assert.equal(others.text, "");
});

test("метка «подозреваю» ставится и снимается", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  room.suspect("Аня", "s3");
  assert.deepEqual(room.state().suspicion, { s3: ["Аня"] });
  room.suspect("Аня", "s3", false);
  assert.deepEqual(room.state().suspicion, { s3: [] });
});

test("снимок и восстановление сохраняют стол и роли", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  room.note("Аня", "заметка", true);
  room.suspect("Аня", "s3");
  const restored = new Room("test", caseData, () => {});
  restored.load(JSON.parse(JSON.stringify(room.snapshot())));
  assert.deepEqual(restored.state("Аня"), room.state("Аня"));
  assert.deepEqual(restored.state("Боря").cards, room.state("Боря").cards);
});

test("неверное обвинение закрывает дело", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  room.accuse("Аня", "s1");
  assert.equal(room.attempts, 1);
  assert.equal(room.finished.result, "loss");
  assert.equal(room.finished.rating, "A");
});

test("верное обвинение с двумя линиями — победа с оценкой", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  for (const id of ["c1", "c2"]) {
    const owner = [...room.players.keys()].find((name) =>
      room.players.get(name).roles.includes(caseData.clues.find((c) => c.id === id).role),
    );
    room.attach(owner, id);
  }
  room.accuse("Аня", caseData.culprit);
  assert.equal(room.finished.result, "win");
  assert.equal(room.finished.rating, "A");
});

test("после закрытия дела обвинять нельзя", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.start("Аня");
  room.accuse("Аня", "s1");
  assert.throws(() => room.accuse("Боря", "s3"), /game_over/);
});

test("ведущий видит все документы и правду, игрок — только свои", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.join("Гоша", null, "host");
  room.start("Аня");
  const host = room.packetFor("Гоша");
  assert.equal(host.clues.length, caseData.clues.length);
  assert.equal(host.truth.culprit, caseData.culprit);
  assert.equal(room.packetFor("Аня").truth, undefined);
});

test("ведущий открывает улику чужой роли", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.join("Гоша", null, "host");
  room.start("Аня");
  const foreign = caseData.clues.find((clue) => !room.players.get("Аня").roles.includes(clue.role));
  room.attach("Гоша", foreign.id);
  assert.ok(room.evidence.has(foreign.id));
});

test("наблюдатель молчит и не обвиняет", () => {
  const { room } = makeRoom(["Аня", "Боря"]);
  room.join("Соня", null, "observer");
  room.start("Аня");
  assert.throws(() => room.say("Соня", "подсказка"), /observer_silent/);
  assert.throws(() => room.accuse("Соня", caseData.culprit), /not_your_call/);
});

test("ведущий не обвиняет, роли достаются только игрокам", () => {
  const { room } = makeRoom(["Аня"]);
  room.join("Гоша", null, "host");
  assert.throws(() => room.start("Аня"), /need_two/);
  room.join("Боря", null, "player");
  room.start("Аня");
  assert.deepEqual(room.packetFor("Гоша").roles, []);
  assert.deepEqual([...room.players.values()].flatMap((player) => player.roles).sort(), [...CORE_ROLES].sort());
  assert.throws(() => room.accuse("Гоша", caseData.culprit), /not_your_call/);
});
