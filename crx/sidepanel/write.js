// chira-ura v2 — sidepanel: 書く（保存とコピーだけ）
import { copy } from "../scripts/clipboard.js";
import { createFlasher } from "../scripts/flash.js";

const NOTES_KEY = "notes";
const ACTIVE_KEY = "activeNoteId";
const AUTO_KEY = "autoSave";
const DEBOUNCE_MS = 600;

const els = {
  note: document.getElementById("note"),
  status: document.getElementById("status"),
  btnCopy: document.getElementById("btnCopy")
};

const flasher = createFlasher(els.status);

let notes = [];
let activeNoteId = null;
let autoSave = true;
let timer = null;

// ---------- 初期化 ----------
async function init() {
  const res = await chrome.storage.local.get([NOTES_KEY, ACTIVE_KEY, AUTO_KEY]);
  notes = res[NOTES_KEY] || [];
  activeNoteId = res[ACTIVE_KEY] || null;
  autoSave = res[AUTO_KEY] !== false;

  const note = activeNoteId ? getNote(activeNoteId) : notes[0];
  if (note) {
    activeNoteId = note.id;
    els.note.value = note.content;
  } else {
    activeNoteId = null;
    els.note.value = "";
  }
  flasher.idle(els.note.value.trim() ? "saved" : null);
}

// ---------- データ ----------
function getNote(id) {
  return notes.find(n => n.id === id);
}

// タイトルは本文の1行目から導出（UI を増やさない）
function deriveTitle(content) {
  const line = (content || "").split("\n").map(s => s.trim()).find(Boolean) || "";
  return line.slice(0, 30) || "無題";
}

function upsertActive(content) {
  const now = Date.now();
  let note = getNote(activeNoteId);
  if (!note) {
    note = {
      id: "note-" + now + "-" + Math.random().toString(36).slice(2, 6),
      title: deriveTitle(content),
      content,
      updatedAt: now
    };
    notes.unshift(note);
    activeNoteId = note.id;
  } else {
    note.title = deriveTitle(content);
    note.content = content;
    note.updatedAt = now;
  }
}

async function save() {
  await chrome.storage.local.set({
    [NOTES_KEY]: notes,
    [ACTIVE_KEY]: activeNoteId
  });
  flasher.flash("saved");
}

function queueSave() {
  upsertActive(els.note.value);
  if (!autoSave) {
    flasher.flash("dirty");
    return;
  }
  flasher.flash("saving");
  clearTimeout(timer);
  timer = setTimeout(save, DEBOUNCE_MS);
}

// ---------- イベント ----------
els.note.addEventListener("input", queueSave);

els.btnCopy.addEventListener("click", async () => {
  const text = els.note.value;
  if (!text.trim()) {
    flasher.flash("empty");
    return;
  }
  try {
    if (!autoSave) await save();
    await copy(text);
    flasher.flash("copied");
  } catch (_) {
    flasher.flash("fail");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[AUTO_KEY]) autoSave = changes[AUTO_KEY].newValue !== false;
});

init();
