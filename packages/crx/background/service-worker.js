// chira-ura v2 — background: ブリッジ同期（GDrive が正）
// CLI が `chira serve` を立てている時だけ、state を pull して chrome.storage に写す。
// 拡張側から push はしない（正は GDrive）。

import { fetchState, applyState } from "../scripts/bridge.js";

const ALARM = "bridge-sync";
const PERIOD_MIN = 5;

chrome.runtime.onInstalled.addListener(async () => {
  const res = await chrome.storage.local.get(["notes", "box", "keys"]);
  if (!res.notes) {
    await chrome.storage.local.set({
      notes: [],
      box: "gdrive",
      keys: {}
    });
  }
  if (res.box !== "gdrive") await chrome.storage.local.set({ box: "gdrive" });
  setupAlarm();
  syncNow();
});

chrome.runtime.onStartup?.addListener(() => {
  setupAlarm();
  syncNow();
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) syncNow();
});

function setupAlarm() {
  chrome.alarms?.create(ALARM, { periodInMinutes: PERIOD_MIN });
}

async function syncNow() {
  try {
    const { autoSync } = await chrome.storage.local.get(["autoSync"]);
    if (autoSync === false) return;
    const state = await fetchState();
    const patch = await applyState(state);
    if (chrome.action?.setTitle) {
      chrome.action.setTitle({ title: `chira-ura — 同期 rev ${patch.bridgeRev ?? "-"}` });
    }
  } catch (_) {
    // ブリッジ未起動は正常（ローカルで動く）
  }
}

// CLI から明示的に引かれたとき
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "sync-now") {
    syncNow().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
