// kami copi v2 — popup: コマンド一覧（書く/読む/コピー/設定）
import { copy } from "../scripts/clipboard.js";
import { createFlasher } from "../scripts/flash.js";

const NOTES_KEY = "notes";
const ACTIVE_KEY = "activeNoteId";
const AUTO_KEY = "autoSave";
const CLOUD_KEY = "cloudSync";
const GAS_URL_KEY = "gasUrl";

const WRITE_PATH = "sidepanel/index.html";
const LOG_PATH = "sidepanel/log.html";
const GH_URL = "https://github.com/bonsai/kami-copi";

const els = {
  status: document.getElementById("status"),
  cmdWrite: document.getElementById("cmdWrite"),
  cmdLog: document.getElementById("cmdLog"),
  cmdCopy: document.getElementById("cmdCopy"),
  cmdAuto: document.getElementById("cmdAuto"),
  cmdCloud: document.getElementById("cmdCloud"),
  cmdCli: document.getElementById("cmdCli"),
  cmdBox: document.getElementById("cmdBox"),
  hintAuto: document.getElementById("hintAuto"),
  hintCloud: document.getElementById("hintCloud"),
  cliBody: document.getElementById("cliBody"),
  linkGh: document.getElementById("linkGh")
};

const flasher = createFlasher(els.status);

let notes = [];
let activeNoteId = null;
let autoSave = true;
let cloudSync = false;
let gasUrl = "";

// ---------- 表示 ----------
function paint() {
  els.hintAuto.textContent = autoSave ? "on" : "off";
  els.hintAuto.classList.toggle("on", autoSave);
  els.hintCloud.textContent = cloudSync ? "on" : "off";
  els.hintCloud.classList.toggle("on", cloudSync);
  if (gasUrl) {
    els.cmdBox.href = gasUrl;
    els.cmdBox.hidden = false;
  } else {
    els.cmdBox.hidden = true;
  }
}

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

  if (GH_URL) {
    els.linkGh.href = GH_URL;
    els.linkGh.hidden = false;
  }
  paint();
}

// ---------- サイドパネルを開く ----------
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
els.cmdLog.addEventListener("click", () => openPanel(LOG_PATH));

els.cmdCopy.addEventListener("click", async () => {
  const note = notes.find(n => n.id === activeNoteId) || notes[0];
  const text = note?.content || "";
  if (!text.trim()) {
    flasher.flash("empty");
    return;
  }
  try {
    // 前置き無し＝そのままプロンプトに流せる
    await copy(text);
    flasher.flash("copied");
  } catch (_) {
    flasher.flash("fail");
  }
});

els.cmdAuto.addEventListener("click", async () => {
  autoSave = !autoSave;
  await chrome.storage.local.set({ [AUTO_KEY]: autoSave });
  paint();
  flasher.flash(autoSave ? "saved" : "dirty");
});

els.cmdCloud.addEventListener("click", async () => {
  cloudSync = !cloudSync;
  await chrome.storage.local.set({ [CLOUD_KEY]: cloudSync });
  paint();
  if (cloudSync && !gasUrl) flasher.flash("gas");
  else flasher.flash(cloudSync ? "saved" : "dirty");
});

els.cmdCli.addEventListener("click", () => {
  els.cliBody.hidden = !els.cliBody.hidden;
  els.cmdCli.classList.toggle("open", !els.cliBody.hidden);
});

// サイドパネル側で変わっても追従
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[NOTES_KEY]) notes = changes[NOTES_KEY].newValue || [];
  if (changes[ACTIVE_KEY]) activeNoteId = changes[ACTIVE_KEY].newValue || null;
  if (changes[AUTO_KEY]) autoSave = changes[AUTO_KEY].newValue !== false;
  if (changes[CLOUD_KEY]) cloudSync = changes[CLOUD_KEY].newValue === true;
  if (changes[GAS_URL_KEY]) gasUrl = changes[GAS_URL_KEY].newValue || "";
  paint();
});

init();
