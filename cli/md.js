// chira-ura CLI — ノートを「md 単独ファイル」へ出し入れする
//
// DB（~/.chira/ura.db）が正。md は可搬なビュー（人が読む / rum で編集する）。
// 1 ノート = 1 ファイル。front matter に id/title/updatedAt を持つので、
// 編集して戻しても同じノートにマージできる（同じ id は新しい updatedAt を採用）。
//
//   chira md [dir]          DB → dir/*.md（既定 ~/.chira/md）
//   chira md import [dir]   dir/*.md → DB（本文が変わっていれば updatedAt を今に上げる）
//
// rum（gui/rum）はこの dir を開いて読み書きするだけ。DB には触らない。

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deriveTitle, makeNote, noteJson } from "../crx/scripts/model.js";
import { listNotes, getNote, upsertNote } from "./ura-db.js";

export const DEFAULT_MD_DIR = process.env.CHIRA_MD_DIR || join(homedir(), ".chira", "md");

/** ファイル名に使える slug（日本語は残す。空白と記号だけ畳む） */
export function slugify(text, max = 40) {
  const s = String(text || "")
    .replace(/[\u0000-\u001f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return s.slice(0, max) || "untitled";
}

/** note id の末尾 4 文字（ファイル名の安定キー） */
export function idSuffix(id) {
  return String(id || "").replace(/[^a-z0-9]/gi, "").slice(-4) || "0000";
}

const esc = (s) => JSON.stringify(String(s ?? ""));
const normBody = (s) => String(s ?? "").replace(/\n+$/, "");

/** 1 ノート → ファイル名（<id4>-<slug>.md） */
export function mdFileName(note) {
  const title = note.title || deriveTitle(note.content);
  return `${idSuffix(note.id)}-${slugify(title)}.md`;
}

/** 1 ノート → md（front matter + 本文） */
export function toMarkdown(note) {
  const body = String(note.content ?? "");
  const fm = [
    "---",
    `id: ${esc(note.id)}`,
    `title: ${esc(note.title || deriveTitle(body))}`,
    `updatedAt: ${Number(note.updatedAt) || 0}`,
    "---",
    ""
  ].join("\n");
  return `${fm}\n${body}${body.endsWith("\n") ? "" : "\n"}`;
}

function unquote(v) {
  const t = String(v ?? "").trim();
  if (t.startsWith('"')) {
    try { return JSON.parse(t); } catch { return t.replace(/^"|"$/g, ""); }
  }
  return t;
}

/** md → ノート。front matter が無ければ fallbackId を使う */
export function parseMarkdown(text, fallbackId = null) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const fm = { id: null, title: null, updatedAt: null };
  let body = src;

  if (src.startsWith("---")) {
    const nl = src.indexOf("\n");
    if (nl >= 0) {
      const lines = src.slice(nl + 1).split("\n");
      let end = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "---") { end = i; break; }
        const m = lines[i].match(/^([A-Za-z_][\w.-]*):\s*(.*)$/);
        if (!m) continue;
        const val = unquote(m[2]);
        if (m[1] === "id") fm.id = val;
        else if (m[1] === "title") fm.title = val;
        else if (m[1] === "updatedAt") fm.updatedAt = Number(val) || null;
      }
      if (end >= 0) body = lines.slice(end + 1).join("\n").replace(/^\n/, "");
    }
  }

  const content = body.replace(/\n$/, "");
  return {
    id: fm.id || fallbackId || null,
    title: fm.title || deriveTitle(content),
    content,
    updatedAt: fm.updatedAt || 0
  };
}

/** 既存 md ファイルの id → ファイル名（再 export で名前を保つ） */
function existingNames(dir) {
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith(".md")) continue;
    try {
      const parsed = parseMarkdown(readFileSync(join(dir, f), "utf8"), null);
      if (parsed.id) map.set(parsed.id, f);
    } catch { /* 壊れたファイルは無視 */ }
  }
  return map;
}

/** DB の全ノートを dir へ md 出力する */
export function exportMarkdown(db, dir = DEFAULT_MD_DIR) {
  mkdirSync(dir, { recursive: true });
  const keep = existingNames(dir);
  const used = new Set();
  const files = [];
  for (const note of listNotes(db)) {
    let name = keep.get(note.id) || mdFileName(note);
    let n = 1;
    const base = name.replace(/\.md$/i, "");
    while (used.has(name)) name = `${base}-${n++}.md`;
    used.add(name);
    writeFileSync(join(dir, name), toMarkdown(note), "utf8");
    files.push(name);
  }
  return { dir, count: files.length, files };
}

/**
 * dir の md を DB へ取り込む。
 * - front matter に id が無いファイルは新規ノートを作り、id を書き戻す。
 * - 本文/タイトルが変わっていれば updatedAt を今に上げて upsert する。
 */
export function importMarkdown(db, dir = DEFAULT_MD_DIR, { writeBack = true } = {}) {
  if (!existsSync(dir)) return { dir, total: 0, changed: 0, created: 0 };
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md"));
  let total = 0, changed = 0, created = 0;

  for (const f of files) {
    const path = join(dir, f);
    let text;
    try { text = readFileSync(path, "utf8"); } catch { continue; }
    total++;

    const parsed = parseMarkdown(text, null);

    if (!parsed.id) {
      const made = makeNote(parsed.content);
      const r = upsertNote(db, made);
      if (r.changed) { changed++; created++; }
      if (writeBack) writeFileSync(path, toMarkdown(r.note), "utf8");
      continue;
    }

    const cur = getNote(db, parsed.id);
    // 末尾改行の差は「同じ本文」とみなす（export → import を厳密に no-op にする）
    const bodyChanged =
      !cur || normBody(cur.content) !== normBody(parsed.content) || cur.title !== parsed.title;
    const candidate = noteJson({
      ...parsed,
      updatedAt: bodyChanged ? Math.max(parsed.updatedAt || 0, Date.now()) : parsed.updatedAt || (cur ? cur.updatedAt : Date.now())
    });
    const r = upsertNote(db, candidate);
    if (r.changed) changed++;
    if (writeBack && bodyChanged) writeFileSync(path, toMarkdown(r.note), "utf8");
  }

  return { dir, total, changed, created };
}
