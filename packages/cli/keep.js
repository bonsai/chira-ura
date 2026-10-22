// chira-ura CLI — Google Keep Takeout からの取り込み
//
// 入力:
//   takeout-*.zip            / Takeout/Keep/Notes.json + Notes.html
//   展開ディレクトリ          / Takeout/Keep/...
//   Notes.json / Notes.html 単体
// 出力: 拡張と同じ JSON（{id, title, content, updatedAt}）
//   chira-ura 側の DB（repo の隣 / ura.db）か JSONL に入れる。
//
// Takeout はローカル zip だけ。トークン・鍵は扱わない。

import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, basename, extname, sep } from "node:path";
import { deriveTitle } from "../crx/scripts/model.js";

// ---------- zip（最小実装: store / deflate） ----------
const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** zip → Map<名前, Buffer> */
export function zipEntries(buf) {
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error("zip ではない（EOCD が見つからない）");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CD_SIG) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);

    let content;
    if (method === 0) content = Buffer.from(data);
    else if (method === 8) content = inflateRawSync(data);
    else throw new Error(`未対応の圧縮方式: ${method}（${name}）`);

    if (!name.endsWith("/")) out.set(name, content);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------- 時刻（Keep は µs / ms / RFC3339 が混在する） ----------
export function toEpochMs(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return value > 1e14 ? Math.round(value / 1000) : Math.round(value);
  const s = String(value).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 1e14 ? Math.round(n / 1000) : n;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

// ---------- Keep のメモ → 拡張と同じ JSON ----------
/** 本文: textContent + lists + annotations */
export function keepContent(keep) {
  const parts = [];
  const text = String(keep.textContent || "").trim();
  if (text) parts.push(text);
  for (const l of keep.lists || []) {
    const t = String(l.title || "").trim();
    if (t) parts.push(`- [${l.isChecked ? "x" : " "}] ${t}`);
  }
  for (const a of keep.annotations || []) {
    const url = String(a.url || "").trim();
    if (!url) continue;
    const t = String(a.title || "").trim();
    parts.push(t && t !== url ? `${t}: ${url}` : url);
  }
  return parts.join("\n");
}

/** Keep の1件 → {id, title, content, updatedAt} */
export function keepToNote(keep) {
  const content = keepContent(keep);
  const title = String(keep.title || "").trim() || deriveTitle(content);
  const id = String(keep.id || "").trim() || `keep-${hash(content)}`;
  const updatedAt =
    toEpochMs(keep.userEditedTimestampUsec) || toEpochMs(keep.updateTime) || toEpochMs(keep.createTime);
  return { id, title, content, updatedAt };
}

function hash(text) {
  return createHash("sha1").update(String(text)).digest("hex").slice(0, 12);
}

// ---------- Notes.json ----------
export function parseKeepJson(text) {
  let arr;
  try {
    arr = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON が壊れている: ${e.message}`);
  }
  if (!Array.isArray(arr)) arr = [arr];
  return arr.filter((k) => k && typeof k === "object");
}

// ---------- Notes.html（ラベル付き） ----------
const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&apos;": "'", "&nbsp;": " ", "&hellip;": "…", "&mdash;": "—", "&ndash;": "–"
};

export function decodeEntities(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** タグを落としてテキストに（<br> と </p> は改行） */
export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Notes.html → メモ配列（id は内容から決めるので取り込み直しても重複しない） */
export function parseKeepHtml(text) {
  const html = String(text);
  const blocks = html.split(/<div\s+class="note[^"]*"/i).slice(1);
  const notes = [];
  for (const block of blocks) {
    const title = pick(htmlToText, block, /<div\s+class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const content = pick(htmlToText, block, /<div\s+class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!title && !content) continue;
    const body = content || title;
    notes.push({
      id: `keep-${hash(`${title}\n${body}`)}`,
      title: title || deriveTitle(body),
      content: body,
      updatedAt: 0
    });
  }
  return notes;
}

function pick(fn, block, re) {
  const m = block.match(re);
  return m ? fn(m[1]) : "";
}

// ---------- Takeout を探す ----------
const KEEP_JSON = /^notes\.json$/i;
const KEEP_HTML = /^notes\.html$/i;

/**
 * path から Keep のソースを読む
 * → { notes: [...], sources: [...], skipped: n }
 */
export function readKeepTakeout(path, { includeTrash = false } = {}) {
  if (!existsSync(path)) throw new Error(`見つからない: ${path}`);
  const st = statSync(path);
  let files = [];   // {name, text}

  if (st.isDirectory()) {
    files = walk(path);
  } else if (extname(path).toLowerCase() === ".zip") {
    const entries = zipEntries(readFileSync(path));
    for (const [name, buf] of entries) {
      if (KEEP_JSON.test(basename(name)) || KEEP_HTML.test(basename(name))) {
        files.push({ name, text: buf.toString("utf8") });
      }
    }
  } else {
    files.push({ name: basename(path), text: readFileSync(path, "utf8") });
  }

  if (!files.length) throw new Error(`Keep のファイルが見つからない: ${path}（Notes.json / Notes.html を探す）`);

  const notes = [];
  const sources = [];
  let skipped = 0;

  for (const f of files) {
    if (KEEP_JSON.test(basename(f.name))) {
      sources.push(f.name);
      for (const keep of parseKeepJson(f.text)) {
        if (keep.trashed && !includeTrash) { skipped++; continue; }
        notes.push(keepToNote(keep));
      }
    } else if (KEEP_HTML.test(basename(f.name))) {
      sources.push(f.name);
      notes.push(...parseKeepHtml(f.text));
    }
  }

  if (!sources.length) {
    throw new Error(`Keep のファイルが見つからない: ${path}（Notes.json / Notes.html を探す）`);
  }

  return { notes, sources, skipped };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (KEEP_JSON.test(name) || KEEP_HTML.test(name)) {
      out.push({ name: p.split(sep).join("/"), text: readFileSync(p, "utf8") });
    }
  }
  return out;
}

/** Takeout 展開ディレクトリに Keep があるか */
export function hasKeep(path) {
  if (!existsSync(path)) return false;
  const st = statSync(path);
  if (st.isFile()) return KEEP_JSON.test(basename(path)) || KEEP_HTML.test(basename(path)) || extname(path).toLowerCase() === ".zip";
  return walk(path).length > 0;
}
