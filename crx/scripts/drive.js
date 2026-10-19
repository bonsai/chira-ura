// chira-ura — Drive（OAuth 後に API で解決する）
// フォルダ ID を文書や repo に焼き込まない。名前 or ID を実行時に解決する。
import { googleToken } from "./auth.js";

const API = "https://www.googleapis.com/drive/v3";

async function call(path, token, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive ${res.status}`);
  return res.json();
}

const isId = (s) => /^[A-Za-z0-9_-]{20,}$/.test(s);

/** "folders/<id>" / ID / フォルダ名 を ID に解決 */
export async function resolveFolder(input, token) {
  const raw = (input || "").trim();
  if (!raw) throw new Error("フォルダ未指定");
  const m = raw.match(/folders\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (isId(raw)) return raw;

  const t = token || await googleToken(true);
  const q = `mimeType='application/vnd.google-apps.folder' and name='${raw.replace(/'/g, "\\'")}' and trashed=false`;
  const data = await call("/files", t, { q, fields: "files(id,name)", pageSize: "1" });
  const hit = data.files?.[0];
  if (!hit) throw new Error(`フォルダが見つからない: ${raw}`);
  return hit.id;
}

/** フォルダ直下のファイル一覧（読みたいものだけ読む） */
export async function listFolder(folderId, token) {
  const t = token || await googleToken(true);
  const data = await call("/files", t, {
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,modifiedTime)",
    pageSize: "100",
    orderBy: "modifiedTime desc"
  });
  return data.files || [];
}
