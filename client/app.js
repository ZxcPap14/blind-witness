import { paintAvatars, rememberAvatar } from "./avatar.js";

const ROLE_NAMES = {
  map: "Штурман",
  records: "Писарь",
  witness: "Очевидец",
  autopsy: "Лекарь",
  archive: "Архивист",
};

const KIND_NAMES = {
  trace: "отметка",
  map: "карта",
  alibi: "алиби",
  report: "рапорт",
  testimony: "показание",
  description: "примета",
  expertise: "экспертиза",
  dossier: "досье",
};

const ERRORS = {
  need_name: "Введите имя",
  room_full: "В комнате уже пятеро",
  game_over: "Это дело уже завершено. Введите код другой комнаты.",
  already_started: "Дело уже начато",
  not_host: "Начать может только создатель комнаты",
  need_two: "Нужно минимум двое игроков",
  not_started: "Дело ещё не начато",
  not_yours: "Это документ чужой роли",
  bad_message: "Сломанное сообщение",
  not_joined: "Сначала войдите в комнату",
  unknown_type: "Неизвестное действие",
  observer_silent: "Наблюдатель не участвует в разговоре",
  not_your_call: "Обвинение выдвигают игроки",
};

const MODE_NAMES = { host: "ведущий", observer: "наблюдатель" };

const state = {
  me: null,
  mode: "player",
  truth: null,
  roles: [],
  clues: [],
  suspects: [],
  evidence: [],
  cards: [],
  suspicion: {},
  chat: [],
  players: [],
  host: null,
  started: false,
  startedAt: null,
  finished: null,
};

let socket = null;
let drag = null;
const cardEls = new Map();

const params = new URLSearchParams(location.hash.slice(1));
let code = params.get("room") ?? "";

// Код комнаты — только латиница и цифры, до 16 символов; из ссылки приходит готовым.
function setCode(value) {
  code = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);
  if (code) {
    params.set("room", code);
    location.hash = params.toString();
  }
  return code;
}

function applyCode() {
  const typed = $("roomCode").value.trim();
  if (typed) setCode(typed);
}

const $ = (id) => document.getElementById(id);

function send(message) {
  if (socket?.readyState === 1) socket.send(JSON.stringify({ ...message, code }));
}

$("authForm").addEventListener("submit", (event) => {
  event.preventDefault();
  // Уже вошедшему форма служит только выбором комнаты.
  if (state.me && state.loggedIn) {
    applyCode();
    return connect();
  }
  auth("/api/login");
});

$("registerBtn").addEventListener("click", () => auth("/api/register"));

// Своё лицо: файл уходит на сервер, оттуда его получают все в комнате.
$("avatarBtn").addEventListener("click", () => $("avatarFile").click());

$("avatarFile").addEventListener("change", async () => {
  const file = $("avatarFile").files?.[0];
  if (!file) return;
  $("avatarNote").textContent = "";
  if (file.size > 200 * 1024) return ($("avatarNote").textContent = "Картинка больше 200 КБ");
  const response = await fetch("/api/avatar", { method: "POST", body: file });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return ($("avatarNote").textContent = data.error ?? "Не получилось");
  $("avatarFile").value = "";
  $("avatarNote").textContent = "лицо обновлено";
  rememberAvatar(state.me, data.url);
});

$("guestBtn").addEventListener("click", () => {
  const name = $("name").value.trim();
  if (!name) return ($("joinError").textContent = "Введите имя");
  applyCode();
  state.me = name;
  connect();
});

$("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
});

async function auth(path) {
  $("joinError").textContent = "";
  applyCode();
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: $("name").value.trim(), password: $("password").value }),
  });
  const data = await response.json();
  if (!response.ok) return ($("joinError").textContent = data.error ?? "Не получилось");
  location.reload();
}

async function boot() {
  const me = await fetch("/api/me")
    .then((response) => response.json())
    .catch(() => ({ user: null }));

  if (me.user) {
    state.me = me.user.name;
    state.loggedIn = true;
    $("who").textContent = `${me.user.name} · ${me.stats.wins} из ${me.stats.games}`;
    $("logout").classList.remove("hidden");
    $("avatarBtn").classList.remove("hidden");
    if (code) {
      $("join").classList.add("hidden");
      $("game").classList.remove("hidden");
      return connect();
    }
    // Без кода в ссылке остаётся выбор комнаты: имя берётся из аккаунта.
    $("name").value = me.user.name;
    $("name").disabled = true;
    $("password").classList.add("hidden");
    $("registerBtn").classList.add("hidden");
    $("guestBtn").classList.add("hidden");
    $("loginBtn").textContent = "Войти в комнату";
    $("roomCode").value = "";
    return;
  }

  loadLeaderboard();
  $("roomCode").value = code;

  // Ссылка с именем сразу вводит в комнату (#room=abc&name=Аня).
  if (params.get("name")) {
    state.me = params.get("name").slice(0, 24);
    connect();
  }
}

async function loadLeaderboard() {
  const { rows } = await fetch("/api/leaderboard")
    .then((response) => response.json())
    .catch(() => ({ rows: [] }));
  $("leaderboard").innerHTML = rows.length
    ? rows.map((row) => `<li><span>${escape(row.name)}</span><b>${row.wins} из ${row.games}</b></li>`).join("")
    : `<li class="muted">Пока никто не играл</li>`;
}

function connect() {
  if (!code) setCode(Math.random().toString(36).slice(2, 7));
  $("roomCode").value = code;
  // Комнатой в Cloudflare служит Durable Object, а его выбирают по URL, а не по сообщению.
  const caseId = params.get("case");
  const query = `room=${encodeURIComponent(code)}${caseId ? `&case=${encodeURIComponent(caseId)}` : ""}`;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?${query}`;
  socket = new WebSocket(url);
  socket.addEventListener("open", () => send({ t: "join", name: state.me, mode: $("mode").value }));
  socket.addEventListener("message", (event) => handle(JSON.parse(event.data)));
  socket.addEventListener("close", () => ($("joinError").textContent = "Связь потеряна. Обновите страницу."));
}

function handle(message) {
  switch (message.t) {
    case "welcome":
      state.roles = message.roles ?? [];
      state.mode = message.mode ?? "player";
      state.truth = message.truth ?? null;
      state.clues = message.clues ?? [];
      state.suspects = message.suspects ?? [];
      $("caseTitle").textContent = message.title ?? "Дело";
      $("caseVictim").textContent = message.victim ? `Жертва: ${message.victim}` : "";
      $("join").classList.add("hidden");
      $("game").classList.remove("hidden");
      return render();
    case "state":
      Object.assign(state, {
        players: message.players ?? [],
        host: message.host,
        started: message.started,
        evidence: message.evidence ?? [],
        cards: message.cards ?? [],
        suspicion: message.suspicion ?? {},
        chat: message.chat ?? [],
        startedAt: message.startedAt,
        finished: message.finished ?? null,
      });
      state.truth = message.truth ?? state.truth;
      // Переподключение: режим берём из общего списка, пока сервер не прислал свой пакет.
      const mine = state.players.find((player) => player.name === state.me);
      if (mine?.mode) state.mode = mine.mode;
      $("join").classList.add("hidden");
      $("game").classList.remove("hidden");
      return render();
    case "moved":
      return moveCard(message);
    case "verdict":
      return showVerdict(message);
    case "error":
      return showError(message.code);
  }
}

function showError(code) {
  const text = ERRORS[code] ?? `Ошибка: ${code}`;
  $("joinError").textContent = text;
  const banner = $("verdict");
  banner.classList.remove("hidden", "win", "loss");
  banner.innerHTML = `<strong>Не вышло</strong>${escape(text)}`;
}

function render() {
  $("roomLabel").textContent = code;
  const isHost = state.host === state.me;
  const playing = state.players.filter((player) => player.mode !== "host" && player.mode !== "observer").length;

  $("lobby").classList.toggle("hidden", state.started);
  $("table").classList.toggle("hidden", !state.started);
  $("startBtn").disabled = !isHost || playing < 2;
  $("startBtn").textContent = isHost ? "Начать дело" : "Ждём создателя комнаты";

  $("playerList").innerHTML = state.players
    .map((player) => {
      const roles = player.roles.map((role) => ROLE_NAMES[role] ?? role).join(", ");
      const label = player.mode === "player" ? roles : MODE_NAMES[player.mode] ?? "";
      return `<li><span data-avatar="${escape(player.name)}" data-size="22"></span> ${escape(player.name)}${label ? ` — ${label}` : ""}</li>`;
    })
    .join("");

  $("caseTruth").textContent = state.truth ? `Правда: ${state.truth.name}` : "";
  $("caseTruth").classList.toggle("hidden", !state.truth);

  // Список игроков есть и до старта, поэтому лица рисуем раньше выхода из render().
  paintAvatars();

  if (!state.started) return;

  // Наблюдатель только смотрит: ни приложить, ни подозревать, ни обвинять.
  const canAct = state.mode !== "observer";

  $("clues").innerHTML = state.clues.length
    ? state.clues
        .map((clue) => {
          const attached = state.evidence.includes(clue.id);
          const action = canAct
            ? `<div><button data-attach="${clue.id}" ${attached ? "disabled" : ""}>${attached ? "приложено" : "приложить к делу"}</button></div>`
            : "";
          return `<div class="card-row">
            <span class="tag">${KIND_NAMES[clue.kind] ?? clue.kind}</span>${escape(clue.text)}
            ${action}
          </div>`;
        })
        .join("")
    : `<p class="meta">Дело уже начато, пакеты разобрали — вы наблюдаете со стороны.</p>`;

  renderBoard();

  $("suspectList").innerHTML = state.suspects
    .map((suspect) => {
      const marks = state.suspicion[suspect.id] ?? [];
      const mine = marks.includes(state.me);
      return `<li class="card-row" data-suspect="${suspect.id}">
        <div class="suspect-head">
          <span data-avatar="${escape(suspect.id)}" data-size="46"></span>
          <div>
            <strong>${escape(suspect.name)}</strong>
            <div class="meta">${escape(suspect.about ?? "")}</div>
          </div>
        </div>
        ${marks.length ? `<div class="marks">${marks.map((mark) => `<span>${escape(mark)}</span>`).join("")}</div>` : ""}
        ${canAct ? `<div class="row-buttons">
          <button data-suspect-toggle="${suspect.id}">${mine ? "не подозреваю" : "подозреваю"}</button>
          <button data-ask="${suspect.id}">спросить</button>
          ${state.mode === "player" ? `<button class="wax" data-accuse="${suspect.id}" ${state.finished ? "disabled" : ""}>обвинить</button>` : ""}
        </div>` : ""}
      </li>`;
    })
    .join("");

  const log = $("chatList");
  log.innerHTML = state.chat
    .map((line) => {
      // Строки-события пишет сервер, автора у них нет.
      if (line.from === "—") return `<li class="system">${escape(line.text)}</li>`;
      const face = `<span data-avatar="${escape(line.from)}" data-size="20"></span> `;
      if (line.bot) return `<li class="bot">${face}<b>${escape(line.from)}:</b> ${escape(line.text)}</li>`;
      return `<li>${face}<b>${escape(line.from)}:</b> ${escape(line.text)}</li>`;
    })
    .join("");
  log.scrollTop = log.scrollHeight;
  // Наблюдатель смотрит молча; ведущий-игрок разговаривает наравне со всеми.
  $("chatForm").classList.toggle("hidden", state.mode === "observer");
  $("noteForm").classList.toggle("hidden", state.mode === "observer");

  if (state.finished) {
    const banner = $("verdict");
    banner.classList.remove("hidden");
    banner.classList.toggle("win", state.finished.result === "win");
    banner.classList.toggle("loss", state.finished.result !== "win");
    banner.innerHTML = `<strong>${state.finished.result === "win" ? "Дело раскрыто" : "Дело провалено"}</strong>
      ${escape(state.finished.reason)}
      ${state.finished.rating ? `<p>Оценка: ${state.finished.rating}</p>` : ""}`;
  }
}

function renderBoard() {
  const board = $("board");
  const alive = new Set();

  for (const card of state.cards) {
    alive.add(card.id);
    let el = cardEls.get(card.id);
    if (!el) {
      el = document.createElement("div");
      el.dataset.id = card.id;
      el.className = "card";
      board.appendChild(el);
      cardEls.set(card.id, el);
    }
    el.classList.toggle("clue", card.type === "clue");
    el.classList.toggle("secret", Boolean(card.secret) && !card.locked);
    el.classList.toggle("locked", Boolean(card.locked));
    el.style.left = `${card.x * 100}%`;
    el.style.top = `${card.y * 100}%`;

    const tag =
      card.type === "clue" ? (ROLE_NAMES[card.role] ?? card.role) : card.by ? escape(card.by) : "";
    const body = card.locked ? "<em>закрытая карточка</em>" : escape(card.text);
    const remove =
      card.type === "clue" && state.roles.includes(card.role)
        ? `<button data-detach="${card.id}">убрать</button>`
        : "";
    const face = card.by ? `<span data-avatar="${escape(card.by)}" data-size="20"></span> ` : "";
    el.innerHTML = `<span class="tag">${tag}</span>${face}${body}${remove}`;
  }

  for (const [id, el] of cardEls) {
    if (!alive.has(id)) {
      el.remove();
      cardEls.delete(id);
    }
  }
}

function moveCard({ id, x, y }) {
  if (drag?.id === id) return; // не дёргаем карточку из-под пальца
  const el = cardEls.get(id);
  if (!el) return;
  el.style.left = `${x * 100}%`;
  el.style.top = `${y * 100}%`;
}

// Перетаскивание: pointer-события покрывают мышь и палец одинаково.
$("board").addEventListener("pointerdown", (event) => {
  const el = event.target.closest(".card");
  if (!el || el.classList.contains("locked") || event.target.closest("button")) return;
  el.setPointerCapture(event.pointerId);
  drag = { id: el.dataset.id, el, rect: $("board").getBoundingClientRect(), last: null };
  el.classList.add("dragging");
});

$("board").addEventListener("pointermove", (event) => {
  if (!drag) return;
  const x = (event.clientX - drag.rect.left) / drag.rect.width;
  const y = (event.clientY - drag.rect.top) / drag.rect.height;
  drag.last = { x, y };
  drag.el.style.left = `${x * 100}%`;
  drag.el.style.top = `${y * 100}%`;
});

function endDrag() {
  if (!drag) return;
  const { id, el, last } = drag;
  if (last) send({ t: "move", id, x: last.x, y: last.y });
  el.classList.remove("dragging");
  drag = null;
}

$("board").addEventListener("pointerup", endDrag);
$("board").addEventListener("pointercancel", endDrag);

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.attach) send({ t: "attach", clueId: target.dataset.attach });
  if (target.dataset.detach) send({ t: "detach", clueId: target.dataset.detach });
  if (target.dataset.accuse) send({ t: "accuse", suspect: target.dataset.accuse });
  if (target.dataset.ask) {
    // shortcut: диалог спрашиваем через prompt(), встроенную форму сделаем, если попросят.
    const suspectId = target.dataset.ask;
    const suspect = state.suspects.find((item) => item.id === suspectId);
    const question = prompt(`Что спросить у ${suspect?.name ?? "свидетеля"}?`);
    if (question?.trim()) send({ t: "ask", suspectId, text: question.trim() });
  }
  if (target.dataset.suspectToggle) {
    const suspectId = target.dataset.suspectToggle;
    const mine = (state.suspicion[suspectId] ?? []).includes(state.me);
    send({ t: "suspect", suspectId, on: !mine });
  }
});

$("startBtn").addEventListener("click", () => send({ t: "start" }));

$("noteForm").addEventListener("submit", (event) => {
  event.preventDefault();
  send({ t: "note", text: $("noteText").value, secret: $("noteSecret").checked });
  $("noteText").value = "";
  $("noteSecret").checked = false;
});

$("chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  send({ t: "chat", text: $("chatText").value });
  $("chatText").value = "";
});

setInterval(() => {
  if (!state.startedAt) return;
  const total = Math.floor((Date.now() - state.startedAt) / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  $("timer").textContent = `${minutes}:${seconds}`;
}, 1000);

function showVerdict(message) {
  const banner = $("verdict");
  banner.classList.remove("hidden");
  banner.classList.toggle("win", message.result === "win");
  banner.classList.toggle("loss", message.result === "loss");
  const titles = { win: "Дело раскрыто", loss: "Дело провалено", retry: "Прокурор вернул дело" };
  banner.innerHTML = `<strong>${titles[message.result]}</strong>${escape(message.reason)}`;
}

function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

boot();
