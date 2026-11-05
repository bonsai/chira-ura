// chira-ura v2 — sidepanel: 書く（保存とコピーだけ + /inbox 1分送信）
import { copy } from "../scripts/clipboard.js";
import { createFlasher } from "../scripts/flash.js";
import { deriveTitle } from "../scripts/model.js";
import { formatSessionName, putInbox, getInboxConfig } from "../scripts/inbox.js";

const NOTES_KEY = "notes";
const ACTIVE_KEY = "activeNoteId";
const AUTO_KEY = "autoSave";
const SESSION_KEY = "currentSession";
const INBOX_PENDING_KEY = "inboxPending";

const DEBOUNCE_MS = 600;
const SYNC_INTERVAL_MS = 60 * 1000;       // 1分毎チェック
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10分無更新で closed

const els = {
  note: document.getElementById("note"),
  status: document.getElementById("status"),
  btnCopy: document.getElementById("btnCopy"),
  btnNew: document.getElementById("btnNew")
};

const flasher = createFlasher(els.status);

let notes = [];
let activeNoteId = null;
let autoSave = true;
let timer = null;

// ---------- セッション・送信状態 ----------
let currentSessionName = null;
let lastSentContent = null;
let isDirty = false;
let syncIntervalTimer = null;
let inactivityTimer = null;
let isSessionClosed = false;

// メモリ内キャッシュ（pagehide 時に非同期 storage アクセスなしで即時送信するため）
let cachedInboxConfig = { url: "", token: "" };

async function refreshInboxConfig() {
  cachedInboxConfig = await getInboxConfig();
}

// ---------- セッション初期化 ----------
function startNewSession(timestamp = Date.now()) {
  currentSessionName = formatSessionName(timestamp);
  lastSentContent = null;
  isDirty = false;
  isSessionClosed = false;
  resetInactivityTimer();
}

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  // 10分無更新で closed
  inactivityTimer = setTimeout(() => {
    closeCurrentSession("inactivity");
  }, INACTIVITY_TIMEOUT_MS);
}

// ---------- 初期化 ----------
async function init() {
  const res = await chrome.storage.local.get([
    NOTES_KEY,
    ACTIVE_KEY,
    AUTO_KEY,
    SESSION_KEY,
    INBOX_PENDING_KEY
  ]);
  notes = res[NOTES_KEY] || [];
  activeNoteId = res[ACTIVE_KEY] || null;
  autoSave = res[AUTO_KEY] !== false;

  const note = res[ACTIVE_KEY] === "__new__" ? null : (activeNoteId ? getNote(activeNoteId) : notes[0]);
  if (note) {
    activeNoteId = note.id;
    els.note.value = note.content;
  } else {
    activeNoteId = null;
    els.note.value = "";
  }

  // 設定のキャッシュ取得
  await refreshInboxConfig();

  // セッション名の復元または新規確定
  if (res[SESSION_KEY]?.name && !res[SESSION_KEY]?.closed) {
    currentSessionName = res[SESSION_KEY].name;
    lastSentContent = res[SESSION_KEY].lastSentContent ?? null;
    isSessionClosed = false;
  } else {
    startNewSession();
    await chrome.storage.local.set({
      [SESSION_KEY]: { name: currentSessionName, closed: false, lastSentContent: null }
    });
  }

  flasher.idle(els.note.value.trim() ? "saved" : null);

  // 定期1分チェック開始
  clearInterval(syncIntervalTimer);
  syncIntervalTimer = setInterval(checkAndSyncInbox, SYNC_INTERVAL_MS);

  // オフライン復帰時等の保留分を送信試行
  flushPendingInbox();
}

// ---------- データ ----------
function getNote(id) {
  return notes.find(n => n.id === id);
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
  const text = els.note.value;
  upsertActive(text);
  isDirty = true;
  isSessionClosed = false;
  resetInactivityTimer();

  if (!autoSave) {
    flasher.flash("dirty");
    return;
  }
  flasher.flash("saving");
  clearTimeout(timer);
  timer = setTimeout(save, DEBOUNCE_MS);
}

// ---------- /inbox 送信 ----------
async function checkAndSyncInbox() {
  const content = els.note.value;
  // 変更が無ければ何もしない
  if (!isDirty && content === lastSentContent) {
    await flushPendingInbox();
    return;
  }
  if (!content.trim() && !lastSentContent) {
    return;
  }
  await sendInboxUpdate({ closed: false });
}

async function sendInboxUpdate({ closed = false, keepalive = false } = {}) {
  const content = els.note.value;
  const updatedAt = Date.now();
  const name = currentSessionName;

  const res = await putInbox({
    name,
    content,
    updatedAt,
    closed,
    url: cachedInboxConfig.url,
    token: cachedInboxConfig.token,
    keepalive
  });

  if (res.ok) {
    lastSentContent = content;
    isDirty = false;
    await chrome.storage.local.set({
      [SESSION_KEY]: { name, closed, lastSentContent: content },
      [INBOX_PENDING_KEY]: null
    });
  } else {
    // 送信失敗（オフラインまたは未設定等）時はローカルに保持
    await chrome.storage.local.set({
      [INBOX_PENDING_KEY]: {
        name,
        content,
        updatedAt,
        closed
      }
    });
  }
}

async function flushPendingInbox() {
  try {
    const res = await chrome.storage.local.get([INBOX_PENDING_KEY]);
    const pending = res[INBOX_PENDING_KEY];
    if (!pending) return;

    const result = await putInbox({
      name: pending.name,
      content: pending.content,
      updatedAt: pending.updatedAt,
      closed: pending.closed,
      url: cachedInboxConfig.url,
      token: cachedInboxConfig.token
    });

    if (result.ok) {
      await chrome.storage.local.set({ [INBOX_PENDING_KEY]: null });
    }
  } catch (_) {
    // リトライは次回
  }
}

async function closeCurrentSession(reason = "new") {
  if (isSessionClosed) return;
  const content = els.note.value;
  // 空メモで過去にも送っていない場合はスキップ
  if (!content.trim() && !lastSentContent) {
    isSessionClosed = true;
    return;
  }
  isSessionClosed = true;
  await sendInboxUpdate({ closed: true });
}

// ---------- イベント ----------
els.note.addEventListener("input", queueSave);

// 新規メモ。既存メモは残し、closed 送信して新セッションを開始する。
els.btnNew.addEventListener("click", async () => {
  clearTimeout(timer);
  clearTimeout(inactivityTimer);

  // 1. 現セッションを closed として送信
  await closeCurrentSession("btnNew");

  // 2. 状態初期化 & 新セッション名確定
  activeNoteId = null;
  els.note.value = "";
  startNewSession();
  await chrome.storage.local.set({
    [ACTIVE_KEY]: "__new__",
    [SESSION_KEY]: { name: currentSessionName, closed: false, lastSentContent: null }
  });

  flasher.idle(null);
  els.note.focus();
});

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

// ページを閉じる時（keepalive fetch / sendBeacon fallback）
window.addEventListener("pagehide", () => {
  const content = els.note.value;
  if (!isSessionClosed && (content.trim() || lastSentContent)) {
    isSessionClosed = true;
    putInbox({
      name: currentSessionName,
      content,
      updatedAt: Date.now(),
      closed: true,
      url: cachedInboxConfig.url,
      token: cachedInboxConfig.token,
      keepalive: true
    });
  }
});

// オンライン復帰時に未送信分を流す
window.addEventListener("online", () => {
  flushPendingInbox();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[AUTO_KEY]) autoSave = changes[AUTO_KEY].newValue !== false;
  if (changes.keys || changes.inboxUrl || changes.inboxToken) {
    refreshInboxConfig();
  }
});

init();
