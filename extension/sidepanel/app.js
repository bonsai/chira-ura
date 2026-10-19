// kami copi v2 — sidepanel (memo list + toggles + JSONL import)
import { copy } from "../scripts/clipboard.js";

const NOTES_KEY = "notes";
const ACTIVE_KEY = "activeNoteId";
const AUTO_KEY = "autoSave";
const CLOUD_KEY = "cloudSync";
const GAS_URL_KEY = "gasUrl";
const DEBOUNCE_MS = 600;

const els = {
  note: document.getElementById("note"),
  status: document.getElementById("status"),
  btnCopy: document.getElementById("btnCopy"),
  btnGDrive: document.getElementById("btnGDrive"),
  noteList: document.getElementById("noteList"),
  jsonlFile: document.getElementById("jsonlFile"),
  toast: document.getElementById("toast")
};

let notes = [];
let activeNoteId = null;
let autoSave = true;
let cloudSync = false;
let gasUrl = "";
let timer = null;

// ---------- 初期化 ----------
async function init() {
  const res = await chrome.storage.local.get([
    NOTES_KEY, ACTIVE_KEY, AUTO_KEY, CLOUD_KEY, GAS_URL_KEY
  ]);
  notes = res[NOTES_KEY] || [];
  activeNoteId = res[ACTIVE_KEY] || null;
  autoSave = res[AUTO_KEY] !== false;
  cloudSync = res[CLOUD_KEY] === true;
  gasUrl = res[GAS_URL_KEY] || "";
  applyGasUrl();

  loadActiveNote();
  renderList();
}

function applyGasUrl() {
  if (gasUrl) {
    els.btnGDrive.href = gasUrl;
    els.btnGDrive.style.display = "inline-flex";
  } else {
    els.btnGDrive.style.display = "none";
  }
}

// ---------- ストレージ ----------
async function saveStorage() {
  // toggle（autoSave / cloudSync）の正は popup。ここからは書かない。
  await chrome.storage.local.set({
    [NOTES_KEY]: notes,
    [ACTIVE_KEY]: activeNoteId
  });
  setStatus("保存済み", false);
  renderList();
}

function setStatus(text, saving = false) {
  els.status.textContent = text;
  els.status.className = "status" + (saving ? " saving" : "");
}

function debounceSave() {
  if (!autoSave) return;
  setStatus("保存中…", true);
  if (timer) clearTimeout(timer);
  timer = setTimeout(saveStorage, DEBOUNCE_MS);
}

// ---------- ノート操作 ----------
function createNote(title = "無題", content = "") {
  const now = Date.now();
  const note = {
    id: "note-" + now,
    title,
    content,
    updatedAt: now
  };
  notes.unshift(note);
  activeNoteId = note.id;
  return note;
}

function getNote(id) {
  return notes.find(n => n.id === id);
}

function updateActiveNote(title, content) {
  const note = getNote(activeNoteId);
  if (!note) return;
  note.title = title || "無題";
  note.content = content;
  note.updatedAt = Date.now();
}

function deleteNote(id) {
  notes = notes.filter(n => n.id !== id);
  if (activeNoteId === id) {
    activeNoteId = notes.length ? notes[0].id : null;
  }
}

// ---------- 表示 ----------
function loadActiveNote() {
  const note = activeNoteId ? getNote(activeNoteId) : null;
  if (note) {
    els.note.value = note.content;
    document.title = `${note.title} - kami copi`;
  } else if (notes.length) {
    // 最初のメモを選択
    activeNoteId = notes[0].id;
    els.note.value = notes[0].content;
    document.title = `${notes[0].title} - kami copi`;
  } else {
    els.note.value = "";
    document.title = "kami copi";
  }
  renderList();
}

function renderList() {
  els.noteList.innerHTML = "";
  if (notes.length === 0) {
    els.noteList.innerHTML = '<div class="empty-list">メモがありません</div>';
    return;
  }
  notes.forEach(n => {
    const card = document.createElement("div");
    card.className = `memo-card${n.id === activeNoteId ? " selected" : ""}`;
    const preview = n.content.replace(/\n/g, " ").slice(0, 40);
    const date = new Date(n.updatedAt).toLocaleString("ja-JP", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
    card.innerHTML = `
      <div class="memo-dot"></div>
      <div class="memo-info">
        <div class="memo-title">${escapeHtml(n.title)}</div>
        <div class="memo-preview">${escapeHtml(preview)}</div>
        <div class="memo-preview" style="font-size:0.65rem;opacity:0.6;">${date}</div>
      </div>
      <button class="memo-copy" data-id="${n.id}">コピー</button>
    `;

    card.querySelector(".memo-copy").addEventListener("click", (e) => {
      e.stopPropagation();
      copyMemo(n.id);
    });

    card.addEventListener("click", () => {
      activeNoteId = n.id;
      loadActiveNote();
    });

    els.noteList.appendChild(card);
  });
}

async function copyMemo(id) {
  const n = getNote(id);
  if (!n) return;
  const text = `${n.title}\n\n${n.content}`;
  try {
    await copy(text);
    showToast(`「${n.title}」をコピーしました`);
  } catch (e) {
    showToast("コピーに失敗しました");
  }
}

// ---------- イベント ----------
els.note.addEventListener("input", () => {
  if (activeNoteId) {
    updateActiveNote(null, els.note.value);
    debounceSave();
  } else {
    // 新規作成
    const n = createNote(null, els.note.value);
    saveStorage();
  }
});

els.btnCopy.addEventListener("click", async () => {
  const note = getNote(activeNoteId);
  const text = note ? `${note.title}\n\n${note.content}` : els.note.value;
  if (!text || !text.trim()) {
    showToast("コピーする内容がありません");
    return;
  }
  try {
    await copy(text);
    showToast("クリップボードにコピーしました");
  } catch (e) {
    showToast("コピーに失敗しました");
  }
});

// toggle は popup 側に集約。変更を追従するだけ。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[AUTO_KEY]) autoSave = changes[AUTO_KEY].newValue !== false;
  if (changes[CLOUD_KEY]) cloudSync = changes[CLOUD_KEY].newValue === true;
  if (changes[GAS_URL_KEY]) {
    gasUrl = changes[GAS_URL_KEY].newValue || "";
    applyGasUrl();
  }
});

// JSONL 読み込み（1行1JSON）
els.jsonlFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split("\n").filter(l => l.trim());
  let imported = 0;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.content !== undefined) {
        notes.unshift({
          id: obj.id || "note-" + Date.now() + imported,
          title: obj.title || "無題",
          content: obj.content,
          updatedAt: obj.updatedAt || Date.now()
        });
        imported++;
      }
    } catch (_) {}
  }
  if (imported > 0) {
    if (!activeNoteId) activeNoteId = notes[0].id;
    await saveStorage();
    showToast(`${imported} 件のメモを読み込みました`);
  }
  e.target.value = ""; // リセット
});

// ---------- トースト ----------
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.className = "show";
  setTimeout(() => { els.toast.className = ""; }, 2000);
}

// ---------- エスケープ ----------
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

init();
