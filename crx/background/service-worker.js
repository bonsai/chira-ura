// chira-ura v2 — background (minimal)
// 初期データのみ種付け。同期ロジックはCLI側で担う。

chrome.runtime.onInstalled.addListener(async () => {
  const res = await chrome.storage.local.get(["notes", "defaultBox", "gasUrl"]);
  if (!res.notes) {
    await chrome.storage.local.set({
      notes: [],
      defaultBox: "ふだ / 短冊",
      gasUrl: ""
    });
  }
});
