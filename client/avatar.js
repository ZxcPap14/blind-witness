// Пиксельные аватары рисуются кодом: ни файлов, ни зависимостей.
// Один и тот же seed всегда даёт одно лицо, поэтому персонажи узнаваемы между заходами.

const SIZE = 16;

const SKIN = ["#f0c8a0", "#d9a479", "#b87c50", "#8d5a3b", "#6b4229"];
const HAIR = ["#2b2b2b", "#5a3a22", "#a8763e", "#c9c3b6", "#7b3350"];
const COAT = ["#3b4a5a", "#5a3b3b", "#3b5a44", "#4a3b5a", "#5a523b", "#33404a"];
const EYE = "#241c16";

function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) {
    value ^= char.codePointAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function rng(seed) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

const empty = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

function paintInto(grid, x, y, color) {
  if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) grid[y][x] = color;
}

function box(grid, x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) paintInto(grid, x, y, color);
}

function sprite(seed) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const skin = pick(SKIN);
  const hair = pick(HAIR);
  const coat = pick(COAT);
  const style = Math.floor(random() * 3);
  const accent = Math.floor(random() * 4);
  const accentColor = pick(["#2a2f36", "#5c4033", "#2f4a3a", "#4a3f5c"]);

  const base = empty();
  const eyes = empty();

  box(base, 7, 11, 8, 11, skin);
  box(base, 2, 12, 13, 15, coat);
  box(base, 6, 12, 9, 12, "#26221d");
  box(base, 4, 3, 11, 10, skin);
  for (const [x, y] of [[4, 3], [11, 3], [4, 10], [11, 10]]) paintInto(base, x, y, null);

  if (style === 0) box(base, 3, 2, 12, 4, hair);
  if (style === 1) {
    box(base, 3, 2, 12, 3, hair);
    box(base, 3, 4, 4, 9, hair);
    box(base, 11, 4, 12, 9, hair);
  }
  if (style === 2) {
    box(base, 3, 2, 12, 2, hair);
    box(base, 4, 3, 11, 3, hair);
  }

  // Аксессуар: кепка, очки или шарф — лица не сливаются в толпу.
  if (accent === 1) {
    box(base, 3, 1, 12, 2, accentColor);
    box(base, 2, 3, 13, 3, accentColor);
  }
  if (accent === 3) box(base, 3, 12, 12, 13, accentColor);

  paintInto(base, 7, 9, "#8c5a4a");
  paintInto(base, 8, 9, "#8c5a4a");

  for (const x of [6, 9]) {
    paintInto(eyes, x, 6, EYE);
    paintInto(eyes, x, 7, EYE);
    paintInto(eyes, x, 5, hair);
  }

  if (accent === 2) {
    for (const y of [6, 7]) {
      paintInto(eyes, 5, y, "#4a4a4a");
      paintInto(eyes, 7, y, "#4a4a4a");
      paintInto(eyes, 8, y, "#4a4a4a");
      paintInto(eyes, 10, y, "#4a4a4a");
    }
    paintInto(eyes, 8, 6, "#4a4a4a");
  }

  return { base, eyes };
}

function draw(grid, context) {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const color = grid[y][x];
      if (!color) continue;
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    }
  }
}

// Загруженные лица помним на странице: имя → адрес картинки, null — лица нет.
const faces = new Map();
// Ссылку на Image держим до конца загрузки: брошенный объект Chrome не догружает и onload не зовёт.
const probes = new Map();

const avatarUrl = (name) => `/api/avatar/${encodeURIComponent(name)}`;

function check(name) {
  const probe = new Image();
  probe.onload = () => {
    probes.delete(name);
    faces.set(name, avatarUrl(name));
    // Меняем только спрайты этого имени: полный перерендер сбил бы доску.
    for (const slot of document.querySelectorAll("[data-avatar-name]")) {
      if (slot.dataset.avatarName === name) {
        slot.replaceWith(createAvatar(name, Number(slot.dataset.avatarSize) || 24));
      }
    }
  };
  probe.onerror = () => {
    probes.delete(name);
    faces.set(name, null);
  };
  probes.set(name, probe);
  probe.src = avatarUrl(name);
}

// После загрузки адрес получает метку времени: иначе браузер покажет старую картинку из кеша.
export function rememberAvatar(name, url) {
  faces.set(name, `${url}?t=${Date.now()}`);
  paintAvatars();
}

export function createAvatar(seedText, size = 24) {
  const known = faces.get(seedText);
  // Своё лицо загружено — рисуем картинку вместо спрайта.
  if (typeof known === "string") {
    const img = document.createElement("img");
    img.className = "avatar";
    img.src = known;
    img.alt = "";
    img.title = seedText;
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
    return img;
  }

  if (!faces.has(seedText) && !probes.has(seedText)) check(seedText);

  const { base, eyes } = sprite(hash(seedText));
  const wrap = document.createElement("span");
  wrap.className = "avatar";
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  wrap.title = seedText;
  // Пока спрайт на экране, помним, кого он изображает: по этому имени его заменит загруженное лицо.
  wrap.dataset.avatarName = seedText;
  wrap.dataset.avatarSize = String(size);

  const face = document.createElement("canvas");
  face.width = SIZE;
  face.height = SIZE;
  draw(base, face.getContext("2d"));

  const blink = document.createElement("canvas");
  blink.width = SIZE;
  blink.height = SIZE;
  blink.className = "eyes";
  blink.style.animationDelay = `${(hash(seedText) % 5000) / 1000}s`;
  draw(eyes, blink.getContext("2d"));

  wrap.append(face, blink);
  return wrap;
}

// Сигнатура для теста: одно и то же имя всегда даёт то же лицо.
export function spriteSignature(seedText) {
  const { base, eyes } = sprite(hash(seedText));
  // Цвет кодируется хешем, а не порядком появления: разные палитры дают разные сигнатуры.
  const flat = (grid) =>
    grid
      .flat()
      .map((color) => (color ? hash(color).toString(36).padStart(3, "0").slice(0, 3) : "..."))
      .join("");
  return `${flat(base)}|${flat(eyes)}`;
}

// Заменяет заглушки в разметке на готовые холсты.
export function paintAvatars(root = document) {
  for (const slot of root.querySelectorAll("[data-avatar]")) {
    slot.replaceWith(createAvatar(slot.dataset.avatar, Number(slot.dataset.size) || 24));
  }
}
