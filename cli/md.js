// chira-ura CLI — DB ⇄ md 単独ファイル（1 ノート 1 ファイル）
//
// DB（~/.chira/ura.db）のメモを 1 ノート = 1 ファイルの md として出し入れする。
// 人の目で読め、rum（vim 風 TUI）で編集でき、編集を DB に戻せる可搬ビュー。
// DB が正。md はビュー。往復は front matter の id で対応付ける。

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { listNotes, getNote, upsertNote, addNote } from "./ura-db.js";
import { deriveTitle } from "../crx/scripts/model.js";

export const DEFAULT_MD_DIR = process.env.CHIRA_MD_DIR || join(homedir(), ".chira", "md");

/**
 * id の末尾 4 文字を取得
 */
export function getIdSuffix(id = "") {
  const clean = String(id).replace(/[^a-zA-Z0-9]/g, "");
  return clean.slice(-4) || "0000";
}

/**
 * 日本語 slug 可。
 * ファイル名として使えない文字（/ \ : * ? " < > | および制御文字）や空白をハイフンに正規化。
 */
export function slugify(text = "") {
  const line = String(text).trim().split("\n")[0] || "";
  const cleaned = line
    .replace(/[\\/:*?"<>|\r\n\t]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40) || "note";
}

/**
 * ファイル名を生成: <id末尾4>-<slug>.md
 */
export function generateNoteFileName(note) {
  const suffix = getIdSuffix(note.id);
  const slug = slugify(note.title || deriveTitle(note.content));
  return `${suffix}-${slug}.md`;
}

/**
 * Note オブジェクトから front matter 付きの markdown を生成
 */
export function formatNoteMarkdown(note) {
  const id = note.id || "";
  const title = (note.title !== undefined && note.title !== null) ? String(note.title) : deriveTitle(note.content);
  const updatedAt = Number(note.updatedAt) || Date.now();
  const content = note.content ?? "";

  // YAML front matter: id, title, updatedAt
  // title 内の二重引用符・バックスラッシュをエスケープ
  const safeTitle = JSON.stringify(title);
  const safeId = JSON.stringify(id);

  return `---
id: ${safeId}
title: ${safeTitle}
updatedAt: ${updatedAt}
---

${content}
`.replace(/\r?\n/g, "\n");
}

/**
 * markdown テキストから front matter と content をパース
 * front matter が無い場合は { frontMatter: null, content: raw }
 */
export function parseNoteMarkdown(raw = "") {
  const normalized = String(raw).replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    return {
      frontMatter: null,
      content: normalized
    };
  }

  const yamlBlock = match[1];
  let content = match[2];
  // front matter 直後の先頭改行が 1 つあれば取り除く（formatNoteMarkdown の "\n---\n\n" との対称性）
  if (content.startsWith("\n")) {
    content = content.slice(1);
  }
  // formatNoteMarkdown が末尾に付けた改行が content 自身の末尾に無かった場合の正規化
  // ただし末尾改行はファイル末尾の1改行のみ除去
  if (content.endsWith("\n")) {
    content = content.slice(0, -1);
  }

  const frontMatter = {};
  for (const line of yamlBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let val = trimmed.slice(colonIdx + 1).trim();

    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      try {
        val = JSON.parse(val.startsWith("'") ? `"${val.slice(1, -1).replace(/"/g, '\\"')}"` : val);
      } catch {
        val = val.slice(1, -1);
      }
    } else if (/^\d+$/.test(val)) {
      val = Number(val);
    }
    frontMatter[key] = val;
  }

  return {
    frontMatter,
    content
  };
}

/**
 * 既存ディレクトリ内の .md ファイルを走査し、
 * id -> filename のマップを構築（既存ファイルの id->名前を保ち、再 export で重複ファイルを作らない）
 */
export function scanExistingFiles(dir) {
  const map = new Map(); // id -> filename
  if (!existsSync(dir)) return map;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(dir, entry.name);
    try {
      const text = readFileSync(filePath, "utf8");
      const parsed = parseNoteMarkdown(text);
      if (parsed.frontMatter && parsed.frontMatter.id) {
        map.set(parsed.frontMatter.id, entry.name);
      }
    } catch {
      // 読み取り失敗はスキップ
    }
  }
  return map;
}

/**
 * DB → dir/*.md
 * 既存ファイルの id→名前を保ち、再 export で重複ファイルを作らない。
 */
export function exportNotesToMd(db, dir = DEFAULT_MD_DIR) {
  const targetDir = resolve(dir);
  mkdirSync(targetDir, { recursive: true });

  const existingMap = scanExistingFiles(targetDir);
  const notes = listNotes(db);
  const written = [];

  for (const note of notes) {
    let fileName = existingMap.get(note.id);
    if (!fileName) {
      fileName = generateNoteFileName(note);
      existingMap.set(note.id, fileName);
    }
    const fullPath = join(targetDir, fileName);
    const text = formatNoteMarkdown(note);
    writeFileSync(fullPath, text, "utf8");
    written.push({ id: note.id, file: fileName, path: fullPath });
  }

  return { dir: targetDir, total: notes.length, files: written };
}

/**
 * dir/*.md → DB
 * - 本文/タイトルが変わっていれば updatedAt を now に上げて upsert（同じ id は新しい方）
 * - 変更なしの import は no-op
 * - front matter が無い md は新規ノートにして id を書き戻す
 */
export function importMdToNotes(db, dir = DEFAULT_MD_DIR, options = {}) {
  const targetDir = resolve(dir);
  if (!existsSync(targetDir)) {
    return { dir: targetDir, total: 0, imported: 0, created: 0, unchanged: 0 };
  }

  const entries = readdirSync(targetDir, { withFileTypes: true });
  let total = 0;
  let imported = 0;
  let created = 0;
  let unchanged = 0;
  const now = options.now || Date.now();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const fullPath = join(targetDir, entry.name);
    total++;

    const raw = readFileSync(fullPath, "utf8");
    const parsed = parseNoteMarkdown(raw);

    if (!parsed.frontMatter || !parsed.frontMatter.id) {
      // front matter が無い md は新規ノートにして id を書き戻す
      const content = parsed.content;
      const note = addNote(db, content, now);
      const newText = formatNoteMarkdown(note);
      writeFileSync(fullPath, newText, "utf8");
      created++;
      imported++;
      continue;
    }

    const id = parsed.frontMatter.id;
    const title = parsed.frontMatter.title !== undefined ? String(parsed.frontMatter.title) : deriveTitle(parsed.content);
    const content = parsed.content;
    const fileUpdatedAt = Number(parsed.frontMatter.updatedAt) || 0;

    const cur = getNote(db, id);

    if (!cur) {
      // DB に存在しない id の場合、指定の updatedAt または now で upsert
      upsertNote(db, {
        id,
        title,
        content,
        updatedAt: fileUpdatedAt || now
      });
      imported++;
    } else {
      // DB に既に存在する場合
      const contentChanged = cur.content !== content;
      const titleChanged = cur.title !== title;

      if (!contentChanged && !titleChanged) {
        // 変更なしの import は no-op
        unchanged++;
      } else {
        // 本文/タイトルが変わっていれば updatedAt を now に上げて upsert
        // (同じ id は新しい方を優先するため、cur.updatedAt 以上にする)
        const nextUpdatedAt = Math.max(now, cur.updatedAt + 1);
        upsertNote(db, {
          id,
          title,
          content,
          updatedAt: nextUpdatedAt
        });
        // ファイル側の front matter の updatedAt も更新しておく（ビューと整合）
        const updatedMd = formatNoteMarkdown({
          id,
          title,
          content,
          updatedAt: nextUpdatedAt
        });
        writeFileSync(fullPath, updatedMd, "utf8");
        imported++;
      }
    }
  }

  return { dir: targetDir, total, imported, created, unchanged };
}
