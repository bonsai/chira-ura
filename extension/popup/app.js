// kami copi v2 — popup (write + copy + settings)
import { copy } from "../scripts/clipboard.js";

const NOTE_KEY = "note";
const AUTO_KEY = "autoSave";
const CLOUD_KEY = "cloudSync";
const GAS_URL_KEY = "gasUrl";
const DEBOUNCE_MS = 400;

// gh リンク先（repo 決定後に設定。空なら非表示）
const GH_URL = "";

// 絵文字のみで通知（title にテキストを残す）
const MSG = {
  saving: { e: "💾", t: "保存中" },
  saved:  { e: "📝", t: "ローカル保存済み" },
  copied: { e: "📋", t: "クリップボード保存済み" },
  dirty:  { e: "✏️", t: "未保存（コピーで保存）" },
  gas:    { e: "⚠️", t: "CLI で GAS URL を設定してください" },
  empty:  { e: "✖️", t: "コピーする内容がありません" },
  fail:   { e: "🚫", t: "コピーに失敗しました" }
};

const els = {
  note: document.getElementById("note"),
  status: document.getElementById("status"),
  btnCopy: document.getElementById("btnCopy"),
  btnPast: document.getElementById("btnPast"),
  linkGh: document.getElementById("linkGh"),
  toggleAuto: document.getElementById("toggleAuto"),
  toggleCloud: document.getElementById("toggleCloud")
};

let autoSave = true;
let cloudSync = false;
let gasUrl = "";
let timer = null;
let flashTimer = null;

// ---------- 状態表示 ----------
function flash(key) {
  const m = MSG[key];
  if (!m) return;
  els.status.textContent = m.e;
  els.status.title = m.t;
  els.status.classList.remove("flash");
  void els.status.offsetWidth; // アニメ再開
  els.status.classList.add("flash");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => els.status.classList.remove("flash"), 1400);
}

function idle() {
  els.status.textContent = els.note.value.trim() ? MSG.saved.e : "";
  els.status.title = els.note.value.trim() ? MSG.saved.t : "";
}

// ---------- 保存 ----------
function queueSave() {
  if (!autoSave) {
    flash("dirty");
    return;
  }
  flash("saving");
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await chrome.storage.local.set({ [NOTE_KEY]: els.note.value });
    flash("saved");
  }, DEBOUNCE_MS);
}

// ---------- 初期化 ----------
async function init() {
  const res = await chrome.storage.local.get([
    NOTE_KEY, AUTO_KEY, CLOUD_KEY, GAS_URL_KEY
  ]);
  els.note.value = res[NOTE_KEY] || "";
  autoSave = res[AUTO_KEY] !== false;
  cloudSync = res[CLOUD_KEY] === true;
  gasUrl = res[GAS_URL_KEY] || "";
  els.toggleAuto.checked = autoSave;
  els.toggleCloud.checked = cloudSync;

  if (GH_URL) {
    els.linkGh.href = GH_URL;
    els.linkGh.hidden = false;
  }
  idle();
}

// ---------- イベント ----------
els.note.addEventListener("input", queueSave);

els.btnCopy.addEventListener("click", async () => {
  const text = els.note.value;
  if (!text.trim()) {
    flash("empty");
    return;
  }
  try {
    if (!autoSave) await chrome.storage.local.set({ [NOTE_KEY]: text });
    await copy(text);
    flash("copied");
  } catch (_) {
    flash("fail");
  }
});

// 過去記事 → サイドパネル（一覧・ログ側で扱う）
els.btnPast.addEventListener("click", () => {
  chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  window.close();
});

els.toggleAuto.addEventListener("change", async (e) => {
  autoSave = e.target.checked;
  await chrome.storage.local.set({ [AUTO_KEY]: autoSave });
  if (!autoSave) flash("dirty");
});

els.toggleCloud.addEventListener("change", async (e) => {
  cloudSync = e.target.checked;
  await chrome.storage.local.set({ [CLOUD_KEY]: cloudSync });
  if (cloudSync && !gasUrl) flash("gas");
});

// サイドパネル側で状態が変わっても追従
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[AUTO_KEY]) {
    autoSave = changes[AUTO_KEY].newValue !== false;
    els.toggleAuto.checked = autoSave;
  }
  if (changes[CLOUD_KEY]) {
    cloudSync = changes[CLOUD_KEY].newValue === true;
    els.toggleCloud.checked = cloudSync;
  }
  if (changes[GAS_URL_KEY]) gasUrl = changes[GAS_URL_KEY].newValue || "";
});

init();
