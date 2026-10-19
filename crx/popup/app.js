// kami copi v2 — popup: コマンド（動詞のみ）/ 箱 / クリップボード積み
import { copy } from "../scripts/clipboard.js";
import { createFlasher } from "../scripts/flash.js";
import { pushStack, popStack, stackDepth } from "../scripts/stack.js";
import { boxName, getBox, setBox, mergeKeys, getKeys, KEYS_KEY, BOX_KEY } from "../scripts/boxes.js";
import { googleToken, googleAccount, webAuthCode } from "../scripts/auth.js";

const NOTES_KEY = "notes";
const ACTIVE_KEY = "activeNoteId";
const AUTO_KEY = "autoSave";
const GAS_URL_KEY = "gasUrl";

const WRITE_PATH = "sidepanel/index.html";
const LOG_PATH = "sidepanel/log.html";
const GH_URL = "https://github.com/bonsai/kami-copi";

const els = {
  status: document.getElementById("status"),
  cmdWrite: document.getElementById("cmdWrite"),
  cmdRead: document.getElementById("cmdRead"),
  cmdCopy: document.getElementById("cmdCopy"),
  cmdPush: document.getElementById("cmdPush"),
  cmdPop: document.getElementById("cmdPop"),
  cmdImport: document.getElementById("cmdImport"),
  cmdBox: document.getElementById("cmdBox"),
  badgeStack: document.getElementById("badgeStack"),
  hintBox: document.getElementById("hintBox"),
  boxPanel: document.getElementById("boxPanel"),
  keyHint: document.getElementById("keyHint"),
  keysFile: document.getElementById("keysFile"),
  jsonlFile: document.getElementById("jsonlFile"),
  toggleAuto: document.getElementById("toggleAuto"),
  linkGh: document.getElementById("linkGh")
};

const flasher = createFlasher(els.status);

let notes = [];
let activeNoteId = null;
let autoSave = true;
let box = "local";

// ---------- 表示 ----------
async function paint() {
  els.toggleAuto.checked = autoSave;
  els.hintBox.textContent = boxName(box);
  document.querySelectorAll(".box").forEach(b => {
    b.classList.toggle("active", b.dataset.box === box);
  });
  els.badgeStack.textContent = await stackDepth();
}

// 鍵（gdrive.folder があれば箱を開ける）
function renderKeys(keys) {
  const folder = keys?.gdrive?.folder;
  if (folder) {
    els.keyHint.textContent = "GDrive を開く";
    els.keyHint.dataset.url = folder;
    els.keyHint.classList.add("as-link");
  } else {
    els.keyHint.textContent = "kami set gdrive.token …";
    delete els.keyHint.dataset.url;
    els.keyHint.classList.remove("as-link");
  }
}

function activeText() {
  const note = notes.find(n => n.id === activeNoteId) || notes[0];
  return note?.content || "";
}

// ---------- 初期化 ----------
async function init() {
  const res = await chrome.storage.local.get([
    NOTES_KEY, ACTIVE_KEY, AUTO_KEY, GAS_URL_KEY
  ]);
  notes = res[NOTES_KEY] || [];
  activeNoteId = res[ACTIVE_KEY] || null;
  autoSave = res[AUTO_KEY] !== false;
  box = await getBox();

  if (GH_URL) {
    els.linkGh.href = GH_URL;
    els.linkGh.hidden = false;
  }
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
els.cmdWrite.addEventListener("click", () => openPanel(WRITE_PATH));
els.cmdRead.addEventListener("click", () => openPanel(LOG_PATH));

els.cmdCopy.addEventListener("click", async () => {
  const text = activeText();
  if (!text.trim()) return flasher.flash("empty");
  try {
    await copy(text);
    await pushStack(text);
    flasher.flash("copied");
    await paint();
  } catch (_) {
    flasher.flash("fail");
  }
});

els.cmdPush.addEventListener("click", async () => {
  const text = activeText();
  if (!text.trim()) return flasher.flash("empty");
  const depth = await pushStack(text);
  els.badgeStack.textContent = depth;
  flasher.flash("stacked");
});

els.cmdPop.addEventListener("click", async () => {
  const top = await popStack();
  if (!top) return flasher.flash("empty");
  try {
    await copy(top.text);
    flasher.flash("popped");
  } catch (_) {
    flasher.flash("fail");
  }
  els.badgeStack.textContent = await stackDepth();
});

els.cmdImport.addEventListener("click", () => els.jsonlFile.click());

els.cmdBox.addEventListener("click", () => {
  els.boxPanel.hidden = !els.boxPanel.hidden;
  els.cmdBox.classList.toggle("open", !els.boxPanel.hidden);
});

// ---------- 箱 ----------
// 箱を選ぶ = 認証を伴う（トークンは保存しない）
async function authorize(id) {
  if (id === "gdrive") {
    await googleToken(true);
    const acc = googleAccount();
    flasher.note("🔑", acc ? `GDrive 認証 OK: ${acc}` : "GDrive 認証 OK");
    return;
  }
  if (id === "gh" || id === "box") {
    const keys = await getKeys();
    const clientId = keys?.auth?.[id]?.clientId;
    if (!clientId) {
      flasher.note("⚠️", `client_id 未設定: kami set auth.${id}.clientId <id>`);
      return;
    }
    const conf = id === "gh"
      ? ["https://github.com/login/oauth/authorize", "repo"]
      : ["https://account.box.com/api/oauth2/authorize", ""];
    const { code } = await webAuthCode(id, clientId, conf[0], conf[1]);
    flasher.note("🔑", `${id}: 認可コード取得（トークン交換はサーバ側）`);
    return { code };
  }
  flasher.flash("saved");
}

els.boxPanel.querySelectorAll(".box").forEach(btn => {
  btn.addEventListener("click", async () => {
    try {
      box = await setBox(btn.dataset.box);
      await paint();
      await authorize(box);
    } catch (e) {
      flasher.note("🚫", e?.message || "認証に失敗");
    }
    await paint();
  });
});

// 鍵（CLI が書く keys.json を平文で読込）
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

// ---------- 読み込む（JSONL） ----------
els.jsonlFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  let imported = 0;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.content === undefined) continue;
      notes.unshift({
        id: obj.id || "note-" + Date.now() + "-" + imported,
        title: obj.title || "無題",
        content: obj.content,
        updatedAt: obj.updatedAt || Date.now()
      });
      imported++;
    } catch (_) { /* 壊れた行は捨てる */ }
  }

  if (imported > 0) {
    await chrome.storage.local.set({ [NOTES_KEY]: notes });
    flasher.flash("imported");
  } else {
    flasher.flash("empty");
  }
  e.target.value = "";
});

els.keyHint.addEventListener("click", () => {
  const url = els.keyHint.dataset.url;
  if (url) chrome.tabs.create({ url });
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
  if (changes[ACTIVE_KEY]) activeNoteId = changes[ACTIVE_KEY].newValue || null;
  if (changes[AUTO_KEY]) autoSave = changes[AUTO_KEY].newValue !== false;
  if (changes[BOX_KEY]) box = changes[BOX_KEY].newValue || "local";
  if (changes[KEYS_KEY]) renderKeys(changes[KEYS_KEY].newValue || {});
  await paint();
});

init();
