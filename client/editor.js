const ROLE_NAMES = {
  map: "Штурман",
  records: "Писарь",
  witness: "Очевидец",
  autopsy: "Лекарь",
  archive: "Архивист",
};

const DIMS = [
  ["place", "место"],
  ["time", "время"],
  ["weapon", "оружие"],
];

const PROMPT = `Ты пишешь дело для детективной игры «Слепой свидетель».
Верни ТОЛЬКО JSON, без пояснений и без markdown-обёртки.

{
  "id": "lighthouse-01",
  "title": "Маяк на Ольховой косе",
  "victim": "Ольга Верн, владелица маяка",
  "culprit": "s3",
  "place": "причал",
  "timeOfDeath": "22:40",
  "weapon": "плетёный трос",
  "suspects": [
    { "id": "s1", "name": "Аркадий Лемм", "about": "смотритель маяка, брат жертвы" }
  ],
  "clues": [
    {
      "id": "c1",
      "role": "map",
      "kind": "trace",
      "text": "Пост №3: «Матвей Крюк прошёл к причалу в 22:35»",
      "proves": { "place": "причал" },
      "truthful": true
    }
  ]
}

Правила:
- suspects: 4 или 6 штук, у каждого уникальный id;
- culprit: id одного из подозреваемых;
- role: map, records, witness, autopsy или archive;
- у каждой роли map, records, witness, autopsy минимум три улики;
- правдивые улики вместе должны доказывать место, время и оружие (в proves указывай только подтверждаемые поля, значения совпадают с place, timeOfDeath, weapon);
- ложных улик (truthful: false) не больше трёх, и они тоже выглядят правдоподобно;
- тексты — от лица документов: показания, отметки постов, экспертиза, досье.`;

const emptyCase = () => ({
  id: `case-${Date.now().toString(36)}`,
  title: "",
  victim: "",
  culprit: "s1",
  place: "",
  timeOfDeath: "",
  weapon: "",
  suspects: [
    { id: "s1", name: "", about: "" },
    { id: "s2", name: "", about: "" },
    { id: "s3", name: "", about: "" },
    { id: "s4", name: "", about: "" },
  ],
  clues: ["map", "records", "witness", "autopsy"].map((role, index) => ({
    id: `c${index + 1}`,
    role,
    kind: "",
    text: "",
    proves: {},
    truthful: true,
  })),
});

let draft = emptyCase();

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

function render() {
  for (const field of ["title", "id", "victim", "place", "timeOfDeath", "weapon"]) {
    const input = document.querySelector(`[data-field="${field}"]`);
    if (input) input.value = draft[field] ?? "";
  }

  $("culprit").innerHTML = draft.suspects
    .map((suspect) => `<option value="${esc(suspect.id)}">${esc(suspect.name || suspect.id)}</option>`)
    .join("");
  $("culprit").value = draft.culprit;

  $("suspects").innerHTML = draft.suspects
    .map(
      (suspect, index) => `<div class="row">
        <input data-coll="suspects" data-i="${index}" data-key="id" value="${esc(suspect.id)}" placeholder="id">
        <input data-coll="suspects" data-i="${index}" data-key="name" value="${esc(suspect.name)}" placeholder="Имя">
        <input data-coll="suspects" data-i="${index}" data-key="about" value="${esc(suspect.about)}" placeholder="Кто это">
        <button class="tiny" data-del="suspects" data-i="${index}">×</button>
      </div>`,
    )
    .join("");

  $("clues").innerHTML = draft.clues
    .map((clue, index) => {
      const roles = Object.entries(ROLE_NAMES)
        .map(([role, name]) => `<option value="${role}" ${clue.role === role ? "selected" : ""}>${name}</option>`)
        .join("");
      const proves = DIMS.map(
        ([dim, label]) =>
          `<label class="check"><input type="checkbox" data-prove="${dim}" data-i="${index}" ${clue.proves?.[dim] ? "checked" : ""}>${label}</label>`,
      ).join("");
      return `<div class="clue-row">
        <div class="row">
          <input data-coll="clues" data-i="${index}" data-key="id" value="${esc(clue.id)}" placeholder="id">
          <select data-coll="clues" data-i="${index}" data-key="role">${roles}</select>
          <input data-coll="clues" data-i="${index}" data-key="kind" value="${esc(clue.kind)}" placeholder="вид (trace, alibi…)">
          <button class="tiny" data-del="clues" data-i="${index}">×</button>
        </div>
        <textarea data-coll="clues" data-i="${index}" data-key="text" rows="2" placeholder="Текст улики">${esc(clue.text)}</textarea>
        <div class="row proves">
          ${proves}
          <label class="check"><input type="checkbox" data-lie data-i="${index}" ${clue.truthful === false ? "checked" : ""}>ложная</label>
        </div>
      </div>`;
    })
    .join("");

  $("json").value = JSON.stringify(draft, null, 2);
}

function setField(target) {
  const { coll, i, key, field } = target.dataset;
  if (field) draft[field] = target.value;
  else if (coll) draft[coll][Number(i)][key] = target.value;
}

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.dataset.field || (target.dataset.coll && target.dataset.key)) {
    setField(target);
    $("json").value = JSON.stringify(draft, null, 2);
    if (target.dataset.coll === "suspects" && target.dataset.key === "name") refreshCulprit();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.prove) {
    const clue = draft.clues[Number(target.dataset.i)];
    clue.proves = clue.proves ?? {};
    const dim = target.dataset.prove;
    if (target.checked) clue.proves[dim] = draft[DIMS.find(([key]) => key === dim)[0]];
    else delete clue.proves[dim];
    $("json").value = JSON.stringify(draft, null, 2);
  }
  if ("lie" in target.dataset) {
    draft.clues[Number(target.dataset.i)].truthful = !target.checked;
    $("json").value = JSON.stringify(draft, null, 2);
  }
  if (target.dataset.coll && target.dataset.key) {
    setField(target);
    $("json").value = JSON.stringify(draft, null, 2);
  }
  if (target.id === "culprit") draft.culprit = target.value;
});

function refreshCulprit() {
  const current = $("culprit").value;
  $("culprit").innerHTML = draft.suspects
    .map((suspect) => `<option value="${esc(suspect.id)}">${esc(suspect.name || suspect.id)}</option>`)
    .join("");
  $("culprit").value = draft.suspects.some((s) => s.id === current) ? current : draft.culprit;
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.add === "suspects") {
    draft.suspects.push({ id: `s${draft.suspects.length + 1}`, name: "", about: "" });
    return render();
  }

  if (target.dataset.add === "clues") {
    draft.clues.push({
      id: `c${draft.clues.length + 1}`,
      role: "map",
      kind: "",
      text: "",
      proves: {},
      truthful: true,
    });
    return render();
  }

  if (target.dataset.del) {
    const collection = target.dataset.del;
    const index = Number(target.dataset.i);
    draft[collection].splice(index, 1);
    if (collection === "suspects" && draft.suspects.some((s) => s.id === draft.culprit) === false) {
      draft.culprit = draft.suspects[0]?.id ?? "";
    }
    return render();
  }

  if (target.dataset.tab) {
    for (const button of document.querySelectorAll("[data-tab]")) {
      button.classList.toggle("active", button === target);
    }
    $("tab-form").classList.toggle("hidden", target.dataset.tab !== "form");
    $("tab-prompt").classList.toggle("hidden", target.dataset.tab !== "prompt");
    return;
  }

  if (target.id === "reset") {
    draft = emptyCase();
    $("result").innerHTML = "";
    return render();
  }

  if (target.id === "download") return download();
  if (target.id === "check") return check();
  if (target.id === "copy") return copyPrompt();
  if (target.id === "load") return loadPasted();
});

async function check() {
  const response = await fetch("/api/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  const result = await response.json();
  $("result").className = `result ${result.ok ? "ok" : "bad"}`;
  $("result").innerHTML = result.ok
    ? "<strong>Дело валидно</strong>Все три линии закрыты, роли не пустые, ложных улик в норме."
    : `<strong>Найдено ${result.errors.length}</strong><ul>${result.errors
        .map((error) => `<li>${esc(error)}</li>`)
        .join("")}</ul>`;
}

function download() {
  const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${draft.id || "case"}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function copyPrompt() {
  $("prompt").textContent = PROMPT;
  try {
    await navigator.clipboard.writeText(PROMPT);
    $("copy").textContent = "Скопировано";
  } catch {
    $("copy").textContent = "Скопируйте текст ниже";
  }
}

function loadPasted() {
  $("loadError").textContent = "";
  const raw = $("paste").value.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("не объект");
    draft = {
      ...emptyCase(),
      ...parsed,
      suspects: Array.isArray(parsed.suspects) ? parsed.suspects : [],
      clues: Array.isArray(parsed.clues) ? parsed.clues : [],
    };
    draft.culprit = parsed.culprit ?? draft.suspects[0]?.id;
    render();
    document.querySelector('[data-tab="form"]').click();
  } catch (error) {
    $("loadError").textContent = `Не разобрал JSON: ${error.message}`;
  }
}

$("prompt").textContent = PROMPT;
render();
