import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const PORT = 8113;

async function startServer() {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(PORT), CASE: "lighthouse-01" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  for (let i = 0; i < 60 && !output.includes("http://localhost"); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(output.includes("http://localhost"), `сервер не поднялся: ${output}`);
  return child;
}

function client(name, code) {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const inbox = [];
  const waiters = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    inbox.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.match(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });

  const send = (message) => socket.send(JSON.stringify({ ...message, code }));
  const waitFor = (match, ms = 4000) =>
    new Promise((resolve, reject) => {
      const found = inbox.find(match);
      if (found) return resolve(found);
      const waiter = { match, resolve };
      waiters.push(waiter);
      setTimeout(() => reject(new Error(`таймаут ожидания у ${name}`)), ms);
    });

  return { socket, send, waitFor, inbox };
}

test("два игрока проходят дело до вердикта", async (t) => {
  const server = await startServer();
  t.after(() => server.kill());

  const host = client("Аня", "e2e");
  await once(host.socket, "open");
  host.send({ t: "join", name: "Аня" });
  const welcomeLobby = await host.waitFor((message) => message.t === "state" && message.players.length === 1);
  assert.equal(welcomeLobby.host, "Аня");

  const guest = client("Боря", "e2e");
  await once(guest.socket, "open");
  guest.send({ t: "join", name: "Боря" });
  await host.waitFor((message) => message.t === "state" && message.players.length === 2);

  host.send({ t: "start" });
  const hostView = await host.waitFor((message) => message.t === "welcome");
  const guestView = await guest.waitFor((message) => message.t === "welcome");

  assert.ok(hostView.clues.length > 0);
  assert.equal(hostView.clues[0].proves, undefined);
  assert.notDeepEqual(hostView.clues, guestView.clues);

  const mapRole = [...hostView.roles, ...guestView.roles].includes("map")
    ? hostView.roles.includes("map")
      ? host
      : guest
    : null;
  assert.ok(mapRole, "никому не достался картограф");

  mapRole.send({ t: "attach", clueId: "c1" });
  mapRole.send({ t: "attach", clueId: "c2" });
  await host.waitFor((message) => message.t === "state" && message.evidence.length === 2);

  host.send({ t: "accuse", suspect: "s3" });
  const verdict = await host.waitFor((message) => message.t === "verdict");
  assert.equal(verdict.result, "win");

  const finished = await guest.waitFor((message) => message.t === "state" && message.finished);
  assert.equal(finished.finished.rating, "A");

  host.socket.close();
  guest.socket.close();
});
