// chira-ura — メモの型（拡張と CLI が同じ JSON を使う）
//
// 拡張は chrome.storage.local、CLI は ~/.chira/ura.db（SQLite）。
// どちらも同じ JSON を使うので、export したものをそのまま import できる。
// 形: { id, title, content, updatedAt }

// chrome.storage.local のキー（拡張と同じ名前）
export const STORAGE_KEYS = ["notes", "activeNoteId", "autoSave", "autoSync", "box", "keys", "gasUrl"];

// 箱（保存先）
export const BOXES = ["local", "gdrive", "gh", "box"];

// メモの JSON キー（順序も固定 = export した JSONL の並び）
export const NOTE_KEYS = ["id", "title", "content", "updatedAt"];

/** タイトルは本文の1行目から導出（UI を増やさない） */
export function deriveTitle(content) {
  const line = (content || "").split("\n").map(s => s.trim()).find(Boolean) || "";
  return line.slice(0, 30) || "無題";
}

/** メモの id（拡張と同じ形） */
export function newNoteId(now = Date.now(), rand = Math.random()) {
  return "note-" + now + "-" + rand.toString(36).slice(2, 6);
}

/** メモの JSON を作る（拡張と同じ形） */
export function makeNote(content, now = Date.now()) {
  return {
    id: newNoteId(now),
    title: deriveTitle(content),
    content: content ?? "",
    updatedAt: now
  };
}

/** 外来の JSON をメモの形に寄せる（拡張の JSONL 読込と同じ） */
export function toNote(obj, fallbackId) {
  if (!obj || obj.content === undefined) return null;
  return {
    id: obj.id || fallbackId,
    title: obj.title || "無題",
    content: obj.content,
    updatedAt: obj.updatedAt || Date.now()
  };
}

/** メモ → JSON（NOTE_KEYS の順だけ） */
export function noteJson(note) {
  return {
    id: note.id,
    title: note.title || "",
    content: note.content || "",
    updatedAt: Number(note.updatedAt) || 0
  };
}

/** メモの JSONL（箱のファイル形式。1行1JSON） */
export function toJsonl(notes) {
  const rows = (notes || []).map(n => JSON.stringify(noteJson(n)));
  return rows.length ? rows.join("\n") + "\n" : "";
}

/** JSONL → オブジェクト配列（壊れた行は捨てる。形は問わない） */
export function parseJsonLines(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (_) { /* 壊れた行は捨てる */ }
  }
  return out;
}

/** JSONL → メモ配列（壊れた行は捨てる） */
export function parseJsonl(text) {
  const out = [];
  for (const obj of parseJsonLines(text)) {
    const note = toNote(obj, "note-" + Date.now() + "-" + out.length);
    if (note) out.push(note);
  }
  return out;
}

// ---------- SQLite（~/.chira/ura.db） ----------
// notes は拡張と同じ 4 列だけ。meta は chrome.storage.local の残りを flatstae で持つ。
// FTS は使わない（canonical export/import で壊れないようにするため）。
export const DB_SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL DEFAULT '',
  content   TEXT NOT NULL DEFAULT '',
  updatedAt INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notes_updated ON notes(updatedAt);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
