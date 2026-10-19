// chira-ura — 箱（保存先バックエンド）の定義
// 鍵は chrome.storage.local に平文 JSON で持つ（CLI が書く keys.json を読込んで流し込む）。

export const BOXES = [
  { id: "local",  name: "ローカル", key: null },
  { id: "gdrive", name: "GDrive",   key: "gdrive" },
  { id: "gh",     name: "GitHub",   key: "gh" },
  { id: "box",    name: "Box",      key: "box" }
];

export const BOX_KEY = "box";
export const KEYS_KEY = "keys";

export function boxName(id) {
  return BOXES.find(b => b.id === id)?.name || "ローカル";
}

export async function getBox() {
  const res = await chrome.storage.local.get([BOX_KEY]);
  const id = res[BOX_KEY];
  return BOXES.some(b => b.id === id) ? id : "local";
}

export async function setBox(id) {
  if (!BOXES.some(b => b.id === id)) throw new Error(`未知の箱: ${id}`);
  await chrome.storage.local.set({ [BOX_KEY]: id });
  return id;
}

/** keys.json（CLI が書く平文 JSON）をマージして保存 */
export async function mergeKeys(partial) {
  const res = await chrome.storage.local.get([KEYS_KEY]);
  const cur = (res[KEYS_KEY] && typeof res[KEYS_KEY] === "object") ? res[KEYS_KEY] : {};
  const next = { ...cur };
  for (const [k, v] of Object.entries(partial || {})) {
    next[k] = (v && typeof v === "object") ? { ...(cur[k] || {}), ...v } : v;
  }
  await chrome.storage.local.set({ [KEYS_KEY]: next });
  return next;
}

export async function getKeys() {
  const res = await chrome.storage.local.get([KEYS_KEY]);
  return (res[KEYS_KEY] && typeof res[KEYS_KEY] === "object") ? res[KEYS_KEY] : {};
}
