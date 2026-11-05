// chira-ura v2 — background: 同期サービスワーカー
// dev/cloud-design.md §4・§9-3
// クラウド化に伴いメモの送信は sidepanel → /inbox（1分毎・同名上書き）へ移行。
// localhost ブリッジ pull（GDrive が正）は置き換えられ、
// 明示的な有効化（keys.bridgeEnabled === true または autoSyncBridge === true）時のみ実行される併用・後方互換モードとする。

import { fetchState, applyState } from "../scripts/bridge.js";

const ALARM = "bridge-sync";
const PERIOD_MIN = 5;

chrome.runtime.onInstalled.addListener(async () => {
  const res = await chrome.storage.local.get(["notes", "box", "keys", "bridgeEnabled"]);
  if (!res.notes) {
    await chrome.storage.local.set({
      notes: [],
      box: "local",
      keys: {}
    });
  }
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
    const { autoSync, bridgeEnabled, keys } = await chrome.storage.local.get([
      "autoSync",
      "bridgeEnabled",
      "keys"
    ]);
    // デフォルトでは localhost ブリッジ pull を無効化（/inbox への送信に置き換え）。
    // bridgeEnabled または keys.bridgeEnabled が true の場合のみ後方互換で動作。
    const isBridgeActive = Boolean(bridgeEnabled || keys?.bridgeEnabled);
    if (!isBridgeActive || autoSync === false) return;

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
