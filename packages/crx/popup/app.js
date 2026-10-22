// chira-ura v2 — popup: コマンド（書く/読む/箱/イシュー/履歴）
import { createFlasher } from "../scripts/flash.js";
import { boxName, getBox, setBox, mergeKeys, getKeys, KEYS_KEY, BOX_KEY } from "../scripts/boxes.js";
import { parseJsonl } from "../scripts/model.js";
import { googleToken, googleTokenSilent, googleAccount, webAuthCode } from "../scripts/auth.js";
import { resolveFolder } from "../scripts/drive.js";

const NOTES_KEY = "notes";
const AUTO_KEY = "autoSave";

const WRITE_PATH = "sidepanel/write.html";
const LOG_PATH = "sidepanel/read.html";
const REPO = "https://github.com/bonsai/chira-ura";
const SITE = "https://bonsai.github.io/chira-ura/";
const HISTORY = REPO + "/blob/main/dev/dev.history.md";

const els = {
  status: document.getElementById("status"),
  cmdWrite: document.getElementById("cmdWrite"),
  cmdRead: document.getElementById("cmdRead"),
  cmdBox: document.getElementById("cmdBox"),
  linkVer: document.getElementById("linkVer"),
  linkLogo: document.getElementById("linkLogo"),
  hintBox: document.getElementById("hintBox"),
  boxPanel: document.getElementById("boxPanel"),
  folderInput: document.getElementById("folderInput"),
  keysFile: document.getElementById("keysFile"),
  jsonlFile: document.getElementById("jsonlFile"),
  toggleAuto: document.getElementById("toggleAuto"),
  toggleSync: document.getElementById("toggleSync")
};

const flasher = createFlasher(els.status);

let notes = [];
let autoSave = true;
let autoSync = true;
let box = "gdrive";

// ---------- 表示 ----------
async function paint() {
  els.toggleAuto.checked = autoSave;
  els.toggleSync.checked = autoSync;
  els.hintBox.textContent = boxName(box);
  document.querySelectorAll(".box").forEach(b => {
    b.classList.toggle("active", b.dataset.box === box);
  });
}

function renderKeys(keys) {
  els.folderInput.value = keys?.gdrive?.folderId || keys?.gdrive?.folder || "";
}

// ---------- 初期化 ----------
async function init() {
  const res = await chrome.storage.local.get([NOTES_KEY, AUTO_KEY, "autoSync"]);
  notes = res[NOTES_KEY] || [];
  autoSave = res[AUTO_KEY] !== false;
  autoSync = res.autoSync !== false;
  box = await getBox();

  const m = chrome.runtime.getManifest();
  els.linkVer.textContent = `ver ${m.version_name || m.version}`;
  els.linkVer.href = HISTORY;
  els.linkLogo.href = SITE;

  renderKeys(await getKeys());
  await paint();
}

// ---------- サイドパネル ----------
async function openPanel(path) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      await chrome.sidePanel.setOptions({ tabId: tab.id, path, enabled: true });
      await chrome.sidePanel.open({ tabId: tab.id });
    } else {
      await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    }
  } catch (_) {
    try {
      await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    } catch (e) {
      flasher.flash("fail");
    }
  }
  window.close();
}

// ---------- コマンド ----------
els.cmdRead.addEventListener("click", () => openPanel(LOG_PATH));
els.cmdWrite.addEventListener("click", () => openPanel(WRITE_PATH));

els.cmdBox.addEventListener("click", () => {
  els.boxPanel.hidden = !els.boxPanel.hidden;
  els.cmdBox.classList.toggle("open", !els.boxPanel.hidden);
});

// ---------- 箱（保存先 + 認証） ----------
async function authorize(id, { interactive = false } = {}) {
  if (id === "gdrive") {
    const token = interactive ? await googleToken(true) : await googleTokenSilent();
    if (!token) {
      flasher.note("⚠️", "未同意。同じ箱をもう一度押すと同意画面が出る");
      return;
    }
    const acc = googleAccount();
    flasher.note("🔑", acc ? `GDrive 認証 OK: ${acc}` : "GDrive 認証 OK");
    return;
  }
  if (id === "gh" || id === "box") {
    const keys = await getKeys();
    const clientId = keys?.auth?.[id]?.clientId;
    if (!clientId) {
      flasher.note("⚠️", `client_id 未設定: chira set auth.${id}.clientId <id>`);
      return;
    }
    const conf = id === "gh"
      ? ["https://github.com/login/oauth/authorize", "repo"]
      : ["https://account.box.com/api/oauth2/authorize", ""];
    await webAuthCode(id, clientId, conf[0], conf[1]);
    flasher.note("🔑", `${id}: 認可コード取得（トークン交換はサーバ側）`);
    return;
  }
  flasher.flash("saved");
}

els.boxPanel.querySelectorAll(".box").forEach(btn => {
  btn.addEventListener("click", async () => {
    const same = btn.dataset.box === box;
    try {
      box = await setBox(btn.dataset.box);
      await paint();
      // 1 度目は無言（同意画面を飛ばす）。同じ箱の 2 度目で同意を出す。
      await authorize(box, { interactive: same });
    } catch (e) {
      flasher.note("🚫", e?.message || "認証に失敗");
    }
    await paint();
  });
});

// フォルダ指定（箱の場所）。ID を焼き込まず OAuth で解決する。
els.folderInput.addEventListener("change", async () => {
  const raw = els.folderInput.value.trim();
  if (!raw) return;
  try {
    const folderId = await resolveFolder(raw);
    await mergeKeys({ gdrive: { folderId, folderName: raw } });
    flasher.flash("keyed");
  } catch (e) {
    flasher.note("🚫", e?.message || "フォルダを解決できない");
  }
});

// ファイル（ちょっとしたものを読む）
els.jsonlFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  // 同じ JSON の解析（壊れた行は捨てる / content 無しは捨てる）
  const parsed = parseJsonl(text);
  const imported = parsed.length;

  if (imported > 0) {
    notes.unshift(...parsed);
    await chrome.storage.local.set({ [NOTES_KEY]: notes });
    flasher.flash("imported");
  } else {
    flasher.flash("empty");
  }
  e.target.value = "";
});

// 鍵（CLI が書く keys.json）
els.keysFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const { box: boxFromFile, ...rest } = json;
    await mergeKeys(rest);
    if (boxFromFile) box = await setBox(boxFromFile);
    renderKeys(await getKeys());
    await paint();
    flasher.flash("keyed");
  } catch (_) {
    flasher.flash("fail");
  }
  e.target.value = "";
});

// ---------- 自動同期（CLI ブリッジからの pull） ----------
els.toggleSync.addEventListener("change", async (e) => {
  autoSync = e.target.checked;
  await chrome.storage.local.set({ autoSync });
  flasher.flash(autoSync ? "saved" : "dirty");
});

// ---------- 自動保存 ----------
els.toggleAuto.addEventListener("change", async (e) => {
  autoSave = e.target.checked;
  await chrome.storage.local.set({ [AUTO_KEY]: autoSave });
  flasher.flash(autoSave ? "saved" : "dirty");
});

// ---------- 追従 ----------
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes[NOTES_KEY]) notes = changes[NOTES_KEY].newValue || [];
  if (changes[AUTO_KEY]) autoSave = changes[AUTO_KEY].newValue !== false;
  if (changes.autoSync) autoSync = changes.autoSync.newValue !== false;
  if (changes[BOX_KEY]) box = changes[BOX_KEY].newValue || "gdrive";
  if (changes[KEYS_KEY]) renderKeys(changes[KEYS_KEY].newValue || {});
  await paint();
});

init();
