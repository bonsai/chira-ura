// chira-ura CLI — wiki からのインポート・一覧表示
//
// C:\Users\0501JP\wiki\ などのディレクトリや notes.jsonl などの単体ファイルから
// JSON / JSONL を読み込み、chira-ura のメモ形式 { id, title, content, updatedAt } に変換して取り込む。
//
// ルール:
// - *.json（1ファイル1件想定）
// - *.jsonl（1行1JSON）
// - 日付付きファイル名（例: 2026-10-22-*.json）は時系列で読みやすくソート
// - 拡張と同じ JSON: { id, title, content, updatedAt }（crx/scripts/model.js 共用）
// - スキーマ変換:
//   id: id（無ければ自動生成）
//   title: title（無ければ本文1行目から導出）
//   content: content || body || text
//   updatedAt: updatedAt || updated || createdAt || mtime || now（ms に正規化）
// - 同じ id は上書き（取り込み直しても重複しない）

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { resolve, join, basename, extname } from "node:path";
import { deriveTitle, newNoteId, parseJsonLines } from "../crx/scripts/model.js";

/**
 * タイムスタンプや日付文字列をミリ秒（Number）に正規化する。
 */
export function normalizeTimestamp(val, fallback = Date.now()) {
  if (typeof val === "number" && !isNaN(val)) {
    // 10桁前後の場合は秒単位の UNIX timestamp とみなして ms に変換
    if (val < 10000000000) return Math.floor(val * 1000);
    return Math.floor(val);
  }
  if (typeof val === "string" && val.trim()) {
    const s = val.trim();
    if (/^\d+$/.test(s)) {
      const num = Number(s);
      if (num < 10000000000) return Math.floor(num * 1000);
      return Math.floor(num);
    }
    const parsed = Date.parse(s);
    if (!isNaN(parsed)) return parsed;
  }
  return fallback;
}

/**
 * 外来の JSON オブジェクトを chira-ura メモ形式に変換する。
 */
export function wikiToNote(obj, fallbackId = null, fallbackTime = Date.now()) {
  if (!obj || typeof obj !== "object") return null;

  const rawContent = obj.content ?? obj.body ?? obj.text ?? "";
  const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

  const rawTitle = obj.title;
  const title = (typeof rawTitle === "string" && rawTitle.trim())
    ? rawTitle.trim()
    : deriveTitle(content);

  const rawTime = obj.updatedAt ?? obj.updated ?? obj.createdAt;
  const updatedAt = normalizeTimestamp(rawTime, fallbackTime);

  const id = obj.id
    ? String(obj.id)
    : (fallbackId || newNoteId(updatedAt));

  return {
    id,
    title,
    content,
    updatedAt
  };
}

/**
 * 日付付きファイル名（YYYY-MM-DD や YYYYMMDD 等）を時系列順に自然ソートするための比較関数
 */
export function compareWikiFileNames(a, b) {
  // 日付パターン（2026-10-22 または 20261022 等）があれば優先して比較
  const datePattern = /(\d{4}[-_]?\d{2}[-_]?\d{2})/;
  const matchA = a.match(datePattern);
  const matchB = b.match(datePattern);

  if (matchA && matchB) {
    const normA = matchA[1].replace(/[-_]/g, "");
    const normB = matchB[1].replace(/[-_]/g, "");
    if (normA !== normB) {
      return normA.localeCompare(normB);
    }
  } else if (matchA && !matchB) {
    return -1;
  } else if (!matchA && matchB) {
    return 1;
  }

  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * 単体ファイルまたはディレクトリから対象ファイル（*.json / *.jsonl）のパス一覧を収集しソートする。
 */
export function collectWikiFiles(targetPath) {
  const absPath = resolve(targetPath);
  if (!existsSync(absPath)) {
    throw new Error(`パスが見つかりません: ${targetPath}`);
  }

  const stat = statSync(absPath);
  if (stat.isFile()) {
    const ext = extname(absPath).toLowerCase();
    if (ext === ".json" || ext === ".jsonl") {
      return [absPath];
    }
    throw new Error(`対応していないファイル形式です（*.json / *.jsonl のみ）: ${absPath}`);
  }

  if (stat.isDirectory()) {
    const entries = readdirSync(absPath, { withFileTypes: true });
    const files = [];

    for (const ent of entries) {
      if (ent.isFile()) {
        const ext = extname(ent.name).toLowerCase();
        if (ext === ".json" || ext === ".jsonl") {
          files.push(join(absPath, ent.name));
        }
      }
    }

    files.sort((a, b) => compareWikiFileNames(basename(a), basename(b)));
    return files;
  }

  return [];
}

/**
 * 単一の JSON または JSONL ファイルからメモ配列を読み込む。
 */
export function parseWikiFile(filePath) {
  const text = readFileSync(filePath, "utf8");
  const ext = extname(filePath).toLowerCase();
  const fileStat = statSync(filePath);
  const mtime = Math.floor(fileStat.mtimeMs || fileStat.mtime.getTime());

  const base = basename(filePath);
  const notes = [];

  if (ext === ".json") {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // 不正な JSON の場合はスキップ
      return [];
    }

    if (Array.isArray(parsed)) {
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        const note = wikiToNote(item, null, mtime);
        if (note) notes.push(note);
      }
    } else if (parsed && typeof parsed === "object") {
      const note = wikiToNote(parsed, null, mtime);
      if (note) notes.push(note);
    }
  } else if (ext === ".jsonl") {
    const lines = parseJsonLines(text);
    for (let i = 0; i < lines.length; i++) {
      const note = wikiToNote(lines[i], null, mtime);
      if (note) notes.push(note);
    }
  }

  return notes;
}

/**
 * 指定したパス（ディレクトリまたは単体ファイル）から全メモを読み込んで返す。
 */
export function readWikiNotes(targetPath) {
  const files = collectWikiFiles(targetPath);
  const allNotes = [];

  for (const f of files) {
    const fileNotes = parseWikiFile(f);
    allNotes.push(...fileNotes);
  }

  return allNotes;
}

/**
 * 指定したパス（ディレクトリまたはファイル）のメモを DB（ura-db）に取り込む。
 * 同じ id は上書き（最新の内容で更新）。
 */
export function importWikiNotes(db, targetPath) {
  const notes = readWikiNotes(targetPath);
  let imported = 0;

  db.exec("BEGIN");
  try {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO notes (id, title, content, updatedAt) VALUES (?, ?, ?, ?)"
    );
    for (const n of notes) {
      stmt.run(n.id, n.title, n.content, n.updatedAt);
      imported++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { total: notes.length, imported };
}

/**
 * 指定したパス（ディレクトリまたはファイル）の中身を整形して一覧表示する（取り込まない）。
 */
export function listWikiNotes(targetPath) {
  const notes = readWikiNotes(targetPath);
  return notes;
}
