// chira-ura — localhost ブリッジ（CLI ⇄ 拡張）の共通プロトコル
// 意味はひとつだけ: 「GDrive が正」。state は GDrive を映したミラーで、
// 拡張は pull するだけ（拡張側のローカル値を正にしない）。

export const BRIDGE_PORT = 8787;
export const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
export const STATE_PATH = "/state";

/** ブリッジから state を取得（未起動なら throw） */
export async function fetchState() {
  const res = await fetch(BRIDGE_URL + STATE_PATH, { cache: "no-store" });
  if (!res.ok) throw new Error(`bridge ${res.status}`);
  return res.json();
}

/** state を GDrive ミラーとして chrome.storage に反映する */
export async function applyState(state) {
  const patch = {};
  if (state && typeof state.keys === "object" && state.keys !== null) {
    patch.keys = state.keys;
  }
  if (typeof state.gasUrl === "string") patch.gasUrl = state.gasUrl;
  // 箱の既定は gdrive（GDrive が正）
  patch.box = state.box || "gdrive";
  if (typeof state.rev === "number") patch.bridgeRev = state.rev;

  await chrome.storage.local.set(patch);
  return patch;
}
