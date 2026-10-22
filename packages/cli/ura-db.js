// chira-ura CLI — メモの正 JSON を SQLite（Chrome の読込先 / chira-ura-crx/ura.db）に持つ
//
// 拡張（chrome.storage.local）と同じ JSON（id/title/content/updatedAt）を使う。
// だから export した JSONL / canonical を、そのまま拡張に読み込める。
// 1ファイルで完結させる（journal=DELETE）ので、端末間では同じ .db を
// そのままコピーしてやり取りできる。

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { DB_SCHEMA, makeNote, noteJson, parseJsonl, parseJsonLines, toJsonl } from "../crx/scripts/model.js";

/**
 * 読込先（cli/sync.sh と同じ）
 *   CHIRA_LOAD_DIR を使用（必要）
 */
export function loadDir() {
  const dir = process.env.CHIRA_LOAD_DIR;
  if (dir) return dir;
  throw new Error("CHIRA_LOAD_DIR を設定してください");
}

// DB は読込先ディレクトリ内の ura.db。CHIRA_DB で別の場所にも置ける。
export const DB_PATH = process.env.CHIRA_DB || join(loadDir(), "ura.db");

/** DB を開く（無ければ作る）。パスは任意。 */
export function openDb(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // -wal / -shm を残さない（ファイルは1つ持ち回るだけにする）
  db.exec("PRAGMA journal_mode = DELETE;");
  db.exec(DB_SCHEMA);
  return { db, path };
}

/** メモ一覧（新しい順。crx の read.js と同じ並び） */
export function listNotes(db, query = "") {
  const rows = query
    ? db.prepare(
        `SELECT id, title, content, updatedAt FROM notes
         WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
         ORDER BY updatedAt DESC, id DESC`
      ).all(like(query), like(query))
    : db.prepare(
        "SELECT id, title, content, updatedAt FROM notes ORDER BY updatedAt DESC, id DESC"
      ).all();
  return rows.map(noteJson);
}

function like(q) {
  return `%${String(q).replace(/[\\%_]/g, (m) => "\\" + m)}%`;
}

/** メモを 1 件取り出す */
export function getNote(db, id) {
  const row = db.prepare("SELECT id, title, content, updatedAt FROM notes WHERE id = ?").get(id);
  return row ? noteJson(row) : null;
}

/** メモを書く（同じ id なら新しい updatedAt を採用） */
export function upsertNote(db, note) {
  const n = noteJson(note);
  const cur = getNote(db, n.id);
  if (cur && cur.updatedAt >= n.updatedAt) return { note: cur, changed: false };
  db.prepare(
    "INSERT OR REPLACE INTO notes (id, title, content, updatedAt) VALUES (?, ?, ?, ?)"
  ).run(n.id, n.title, n.content, n.updatedAt);
  return { note: n, changed: true };
}

/** メモを新しく作る（タイトルは本文1行目から） */
export function addNote(db, content, now = Date.now()) {
  const n = makeNote(content, now);
  db.prepare(
    "INSERT OR REPLACE INTO notes (id, title, content, updatedAt) VALUES (?, ?, ?, ?)"
  ).run(n.id, n.title, n.content, n.updatedAt);
  return n;
}

/** メモを消す */
export function removeNote(db, id) {
  const info = db.prepare("DELETE FROM notes WHERE id = ?").run(id);
  return Number(info.changes) > 0;
}

// ---------- meta（chrome.storage.local の残り） ----------
export function getMeta(db, key, fallback = null) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setMeta(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    key,
    JSON.stringify(value === undefined ? null : value)
  );
}

/** meta を全部（生） */
export function metaRows(db) {
  return db.prepare("SELECT key, value FROM meta ORDER BY key").all();
}

// ---------- 拡張と同じ JSON の出し入れ ----------
/** notes → JSONL（箱のファイル形式） */
export function exportJsonl(db) {
  return toJsonl(listNotes(db));
}

/** JSONL → notes */
export function importJsonl(db, text) {
  const notes = parseJsonl(text);
  let changed = 0;
  db.exec("BEGIN");
  try {
    for (const n of notes) if (upsertNote(db, n).changed) changed++;
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { total: notes.length, changed };
}

/** chrome.storage.local 相当のスナップショット */
export function exportStorage(db) {
  return {
    notes: listNotes(db),
    activeNoteId: getMeta(db, "activeNoteId", null),
    autoSave: getMeta(db, "autoSave", true),
    autoSync: getMeta(db, "autoSync", true),
    box: getMeta(db, "box", "local"),
    gasUrl: getMeta(db, "gasUrl", ""),
    keys: getMeta(db, "keys", {})
  };
}

/** スナップショット → notes と meta */
export function importStorage(db, snap) {
  const notes = Array.isArray(snap.notes) ? snap.notes : [];
  let changed = 0;
  db.exec("BEGIN");
  try {
    for (const n of notes) if (upsertNote(db, n).changed) changed++;
    for (const k of ["activeNoteId", "autoSave", "autoSync", "box", "gasUrl", "keys"]) {
      if (snap[k] !== undefined) setMeta(db, k, snap[k]);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { total: notes.length, changed };
}

// ---------- canonical（端末間・GitHub 用の正典） ----------
// 置き先は sync-db の .devices/<device>/<project>/ と同じ形（schema.sql + <table>.jsonl）。

/** schema.sql を1文ずつ実行（既にいるテーブルは飛ばす） */
function execSchema(db, sql) {
  for (const stmt of String(sql).split(/;\s*\n/)) {
    const s = stmt.trim();
    if (!s) continue;
    try {
      db.exec(s);
    } catch (e) {
      if (!/already exists/i.test(String(e.message))) throw e;
    }
  }
}

export function canonicalSchema(db) {
  const rows = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all();
  return rows.map((r) => (r.sql || "").trim() + ";\n").join("");
}

/** canonical へ書き出す */
export function exportCanonical(db, dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "schema.sql"), canonicalSchema(db), "utf8");
  writeFileSync(join(dir, "notes.jsonl"), exportJsonl(db), "utf8");
  writeFileSync(
    join(dir, "meta.jsonl"),
    metaRows(db).map((r) => JSON.stringify(r)).join("\n") + (metaRows(db).length ? "\n" : ""),
    "utf8"
  );
  return dir;
}

/** canonical から読み込む */
export function importCanonical(db, dir) {
  const schemaPath = join(dir, "schema.sql");
  if (existsSync(schemaPath)) execSchema(db, readFileSync(schemaPath, "utf8"));
  // 既存テーブルは IF NOT EXISTS なので、缺口だけ足される
  db.exec(DB_SCHEMA);
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  let total = 0;
  db.exec("BEGIN");
  try {
    for (const f of files) {
      const table = f.slice(0, -6);
      const rows = parseJsonLines(readFileSync(join(dir, f), "utf8"));
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols
          .map(() => "?")
          .join(",")})`
      );
      for (const r of rows) {
        stmt.run(...cols.map((c) => r[c] ?? null));
        total++;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { files: files.length, total };
}
