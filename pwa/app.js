// chira-ura PWA — app.js
import { deriveTitle, newNoteId, toJsonl, parseJsonl, noteJson } from "./model.js";

// ---------- 定数 ----------
const DB_NAME = "chira-ura";
const DB_VERSION = 1;
const STORE_NOTES = "notes";
const DEBOUNCE_MS = 600;

// ---------- DOM 要素 ----------
const els = {
  // Tabs & Views
  tabWrite: document.getElementById("tabWrite"),
  tabList: document.getElementById("tabList"),
  tabRead: document.getElementById("tabRead"),
  viewWrite: document.getElementById("viewWrite"),
  viewList: document.getElementById("viewList"),
  viewRead: document.getElementById("viewRead"),

  // Editor (書く)
  noteEditor: document.getElementById("noteEditor"),

  // List (一覧)
  notesContainer: document.getElementById("notesContainer"),
  listCount: document.getElementById("listCount"),
  btnListNew: document.getElementById("btnListNew"),

  // Read (読む)
  readTitle: document.getElementById("readTitle"),
  readDate: document.getElementById("readDate"),
  readBody: document.getElementById("readBody"),

  // Status & Network
  netStatus: document.getElementById("netStatus"),
  netText: document.getElementById("netText"),
  statusIndicator: document.getElementById("statusIndicator"),
  btnInstall: document.getElementById("btnInstall"),

  // Actions
  btnNew: document.getElementById("btnNew"),
  btnCopy: document.getElementById("btnCopy"),
  btnExport: document.getElementById("btnExport"),
  btnImport: document.getElementById("btnImport"),
  fileImport: document.getElementById("fileImport")
};

// ---------- 状態 ----------
let db = null;
let activeNoteId = null;
let currentView = "write"; // "write" | "list" | "read"
let saveTimer = null;
let deferredInstallPrompt = null;

// ---------- IndexedDB ----------
export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NOTES)) {
        const store = database.createObjectStore(STORE_NOTES, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = (e) => {
      resolve(e.target.result);
    };
    req.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

export function getAllNotes(database) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NOTES, "readonly");
    const store = tx.objectStore(STORE_NOTES);
    const index = store.index("updatedAt");
    const req = index.getAll();
    req.onsuccess = () => {
      // updatedAt 降順（最新順）
      const list = req.result || [];
      list.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export function getNoteById(database, id) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NOTES, "readonly");
    const store = tx.objectStore(STORE_NOTES);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export function putNote(database, note) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NOTES, "readwrite");
    const store = tx.objectStore(STORE_NOTES);
    const req = store.put(noteJson(note));
    req.onsuccess = () => resolve(note);
    req.onerror = () => reject(req.error);
  });
}

export function deleteNoteById(database, id) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NOTES, "readwrite");
    const store = tx.objectStore(STORE_NOTES);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export function batchPutNotes(database, notes) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NOTES, "readwrite");
    const store = tx.objectStore(STORE_NOTES);
    for (const note of notes) {
      store.put(noteJson(note));
    }
    tx.oncomplete = () => resolve(notes.length);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- ステータス通知 (絵文字ベース) ----------
const FLASH_MAP = {
  saving: "✏️ 保存中…",
  saved: "📝 保存完了",
  copied: "📋 コピー完了",
  empty: "⚠️ 空のメモです",
  imported: "📥 インポート完了",
  fail: "🚫 失敗しました"
};

function flashStatus(type) {
  const text = FLASH_MAP[type] || "";
  if (!els.statusIndicator) return;
  els.statusIndicator.textContent = text;
  els.statusIndicator.classList.remove("status-flash");
  // reflow to re-trigger animation
  void els.statusIndicator.offsetWidth;
  els.statusIndicator.classList.add("status-flash");
}

function clearStatusSoon() {
  setTimeout(() => {
    if (els.statusIndicator) {
      els.statusIndicator.textContent = "";
    }
  }, 2500);
}

// ---------- オンライン / オフライン監視 ----------
function updateNetworkStatus() {
  const online = navigator.onLine;
  if (els.netStatus) {
    els.netStatus.classList.toggle("offline", !online);
  }
  if (els.netText) {
    els.netText.textContent = online ? "オンライン" : "オフライン";
  }
}

// ---------- ビュー切り替え ----------
function switchView(viewName) {
  currentView = viewName;

  const tabs = [
    { name: "write", tab: els.tabWrite, panel: els.viewWrite },
    { name: "list", tab: els.tabList, panel: els.viewList },
    { name: "read", tab: els.tabRead, panel: els.viewRead }
  ];

  tabs.forEach(({ name, tab, panel }) => {
    const isActive = name === viewName;
    if (tab) {
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    }
    if (panel) {
      panel.classList.toggle("active", isActive);
    }
  });

  if (viewName === "list") {
    loadAndRenderList();
  } else if (viewName === "write") {
    els.noteEditor?.focus();
  }
}

// ---------- メモの保存・更新 ----------
async function saveActiveNote() {
  const content = els.noteEditor.value;
  if (!content.trim() && !activeNoteId) {
    return;
  }

  const now = Date.now();
  let note;
  if (activeNoteId) {
    note = await getNoteById(db, activeNoteId);
  }

  if (!note) {
    activeNoteId = newNoteId(now);
    note = {
      id: activeNoteId,
      title: deriveTitle(content),
      content,
      updatedAt: now
    };
  } else {
    note.title = deriveTitle(content);
    note.content = content;
    note.updatedAt = now;
  }

  await putNote(db, note);
  localStorage.setItem("activeNoteId", activeNoteId);
  flashStatus("saved");
  clearStatusSoon();
}

function queueSave() {
  flashStatus("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveActiveNote, DEBOUNCE_MS);
}

// ---------- 新規メモ作成 ----------
async function createNewNote() {
  clearTimeout(saveTimer);
  // 現メモの未保存分があれば保存
  if (els.noteEditor.value.trim()) {
    await saveActiveNote();
  }

  activeNoteId = null;
  localStorage.removeItem("activeNoteId");
  els.noteEditor.value = "";
  switchView("write");
  els.noteEditor.focus();
}

// ---------- メモの読み込みと表示 ----------
async function openNoteInEditor(id) {
  const note = await getNoteById(db, id);
  if (!note) return;
  activeNoteId = note.id;
  localStorage.setItem("activeNoteId", activeNoteId);
  els.noteEditor.value = note.content || "";
  switchView("write");
}

async function openNoteInRead(id) {
  const note = await getNoteById(db, id);
  if (!note) return;
  activeNoteId = note.id;
  localStorage.setItem("activeNoteId", activeNoteId);
  els.readTitle.textContent = note.title || "無題";
  els.readDate.textContent = new Date(note.updatedAt || Date.now()).toLocaleString("ja-JP");
  els.readBody.textContent = note.content || "";
  switchView("read");
}

// ---------- 一覧レンダリング ----------
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString("ja-JP", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

async function loadAndRenderList() {
  const notes = await getAllNotes(db);
  els.listCount.textContent = `${notes.length} 件のメモ`;
  els.notesContainer.innerHTML = "";

  if (notes.length === 0) {
    els.notesContainer.innerHTML = '<div class="empty-state">メモはまだありません。「＋ 新規メモ」で書き始めましょう。</div>';
    return;
  }

  notes.forEach((n) => {
    const card = document.createElement("div");
    card.className = "note-card";
    const preview = (n.content || "").replace(/\n/g, " ").slice(0, 100);

    card.innerHTML = `
      <div class="note-card-head">
        <span class="note-card-title">${escapeHtml(n.title || "無題")}</span>
        <span class="note-card-date">${formatDate(n.updatedAt || Date.now())}</span>
      </div>
      <div class="note-card-preview">${escapeHtml(preview)}</div>
      <div class="note-card-actions">
        <button class="btn mini btn-read" data-id="${n.id}" type="button">読む</button>
        <button class="btn mini btn-edit" data-id="${n.id}" type="button">編集</button>
        <button class="btn mini btn-card-copy" data-id="${n.id}" type="button">コピー</button>
        <button class="btn mini danger btn-delete" data-id="${n.id}" type="button">削除</button>
      </div>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openNoteInEditor(n.id);
    });

    card.querySelector(".btn-read").addEventListener("click", () => openNoteInRead(n.id));
    card.querySelector(".btn-edit").addEventListener("click", () => openNoteInEditor(n.id));
    card.querySelector(".btn-card-copy").addEventListener("click", () => copyText(n.content));
    card.querySelector(".btn-delete").addEventListener("click", async () => {
      if (confirm(`メモ「${n.title || "無題"}」を削除しますか？`)) {
        await deleteNoteById(db, n.id);
        if (activeNoteId === n.id) {
          activeNoteId = null;
          localStorage.removeItem("activeNoteId");
          els.noteEditor.value = "";
        }
        await loadAndRenderList();
      }
    });

    els.notesContainer.appendChild(card);
  });
}

// ---------- コピー（本文のみ） ----------
async function copyText(text) {
  if (!text || !text.trim()) {
    flashStatus("empty");
    clearStatusSoon();
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    flashStatus("copied");
    clearStatusSoon();
  } catch (_) {
    // フォールバック
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      flashStatus("copied");
    } catch (err) {
      flashStatus("fail");
    } finally {
      document.body.removeChild(ta);
      clearStatusSoon();
    }
  }
}

// ---------- JSONL Export / Import ----------
async function exportJsonl() {
  const notes = await getAllNotes(db);
  const jsonl = toJsonl(notes);
  const blob = new Blob([jsonl], { type: "application/x-jsonlines;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const nowStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `chira-ura-${nowStr}.jsonl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importJsonl(file) {
  const text = await file.text();
  const notes = parseJsonl(text);
  if (notes.length === 0) {
    flashStatus("fail");
    clearStatusSoon();
    return;
  }
  await batchPutNotes(db, notes);
  flashStatus("imported");
  clearStatusSoon();
  if (currentView === "list") {
    await loadAndRenderList();
  }
}

// ---------- Service Worker 登録 ----------
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then((reg) => {
          console.log("[PWA] Service Worker registered with scope:", reg.scope);
        })
        .catch((err) => {
          console.error("[PWA] Service Worker registration failed:", err);
        });
    });
  }
}

// ---------- PWA インストール プロンプト ----------
function initInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (els.btnInstall) {
      els.btnInstall.style.display = "inline-flex";
    }
  });

  els.btnInstall?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log("[PWA] User install choice:", outcome);
    deferredInstallPrompt = null;
    els.btnInstall.style.display = "none";
  });

  window.addEventListener("appinstalled", () => {
    console.log("[PWA] App was successfully installed");
    if (els.btnInstall) {
      els.btnInstall.style.display = "none";
    }
  });
}

// ---------- イベントリスナー設定 ----------
function setupEventListeners() {
  // ナビゲーション
  els.tabWrite?.addEventListener("click", () => switchView("write"));
  els.tabList?.addEventListener("click", () => switchView("list"));
  els.tabRead?.addEventListener("click", () => switchView("read"));

  // エディタ入力（自動保存）
  els.noteEditor?.addEventListener("input", queueSave);

  // フッター操作
  els.btnNew?.addEventListener("click", createNewNote);
  els.btnListNew?.addEventListener("click", createNewNote);

  els.btnCopy?.addEventListener("click", async () => {
    if (currentView === "write") {
      if (els.noteEditor.value.trim()) {
        await saveActiveNote();
      }
      copyText(els.noteEditor.value);
    } else if (currentView === "read") {
      copyText(els.readBody.textContent);
    } else {
      if (activeNoteId) {
        const note = await getNoteById(db, activeNoteId);
        if (note) copyText(note.content);
      } else {
        flashStatus("empty");
        clearStatusSoon();
      }
    }
  });

  // Export / Import
  els.btnExport?.addEventListener("click", exportJsonl);
  els.btnImport?.addEventListener("click", () => els.fileImport?.click());
  els.fileImport?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      importJsonl(file);
      e.target.value = ""; // リセット
    }
  });

  // オンライン・オフラインイベント
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
}

// ---------- 初期化 ----------
export async function initApp() {
  updateNetworkStatus();
  registerServiceWorker();
  initInstallPrompt();
  setupEventListeners();

  db = await openDb();

  // 前回開いていたメモの復元
  const savedActiveId = localStorage.getItem("activeNoteId");
  if (savedActiveId) {
    const note = await getNoteById(db, savedActiveId);
    if (note) {
      activeNoteId = note.id;
      els.noteEditor.value = note.content || "";
    }
  }

  // もしアクティブなメモがなく、DB にメモがあれば最新のものを読み込む
  if (!activeNoteId) {
    const all = await getAllNotes(db);
    if (all.length > 0) {
      activeNoteId = all[0].id;
      localStorage.setItem("activeNoteId", activeNoteId);
      els.noteEditor.value = all[0].content || "";
    }
  }

  switchView("write");
}

// ブラウザ環境で実行
if (typeof window !== "undefined" && typeof document !== "undefined") {
  initApp().catch((err) => console.error("[PWA] Init failed:", err));
}
