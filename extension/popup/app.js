// kami copi v2 — popup (write + copy + settings)
import { copy } from "../scripts/clipboard.js";
import { createFlasher } from "../scripts/flash.js";

const NOTE_KEY = "note";
const AUTO_KEY = "autoSave";
const CLOUD_KEY = "cloudSync";
const GAS_URL_KEY = "gasUrl";
const DEBOUNCE_MS = 400;
const LOG_PATH = "sidepanel/log.html";

const GH_URL = "https://github.com/bonsai/kami-copi";

const els = {
  note: document.getElementById("note"),
  status: document.getElementById("status"),
  btnCopy: document.getElementById("btnCopy"),
  btnPast: document.getElementById("btnPast"),
  linkGh: document.getElementById("linkGh"),
  toggleAuto: document.getElementById("toggleAuto"),
  toggleCloud: document.getElementById("toggleCloud")
};

const flasher = createFlasher(els.status);

let autoSave = true;
let cloudSync = false;
let gasUrl = "";
let timer = null;

// ---------- 保存 ----------
function queueSave() {
  if (!autoSave) {
    flasher.flash("dirty");
    return;
  }
  flasher.flash("saving");
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await chrome.storage.local.set({ [NOTE_KEY]: els.note.value });
    flasher.flash("saved");
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
  flasher.idle(els.note.value.trim() ? "saved" : null);
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
    if (!autoSave) await chrome.storage.local.set({ [NOTE_KEY]: text });
    await copy(text);
    flasher.flash("copied");
  } catch (_) {
    flasher.flash("fail");
  }
});

// 過去記事 → サイドパネルを log.html に切り替えて開く
els.btnPast.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: LOG_PATH,
        enabled: true
      });
      await chrome.sidePanel.open({ tabId: tab.id });
    } else {
      await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    }
  } catch (_) {
    await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  }
  window.close();
});

els.toggleAuto.addEventListener("change", async (e) => {
  autoSave = e.target.checked;
  await chrome.storage.local.set({ [AUTO_KEY]: autoSave });
  if (!autoSave) flasher.flash("dirty");
});

els.toggleCloud.addEventListener("change", async (e) => {
  cloudSync = e.target.checked;
  await chrome.storage.local.set({ [CLOUD_KEY]: cloudSync });
  if (cloudSync && !gasUrl) flasher.flash("gas");
});

// サイドパネル側で変わっても追従
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
