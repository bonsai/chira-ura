import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, addNote, getNote, listNotes } from "../cli/ura-db.js";
import {
  slugify,
  getIdSuffix,
  generateNoteFileName,
  formatNoteMarkdown,
  parseNoteMarkdown,
  exportNotesToMd,
  importMdToNotes,
  DEFAULT_MD_DIR
} from "../cli/md.js";

function createTempDir(prefix = "chira-md-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("slugify and filename generation", () => {
  assert.equal(slugify("設計メモ"), "設計メモ");
  assert.equal(slugify("Title / with : invalid * chars?"), "Title-with-invalid-chars");
  assert.equal(slugify("   複数の   空白   "), "複数の-空白");
  assert.equal(slugify(""), "note");

  const note = {
    id: "note-1794044819984-f09y",
    title: "設計メモ",
    content: "本文",
    updatedAt: 1794046570513
  };
  assert.equal(getIdSuffix(note.id), "f09y");
  assert.equal(generateNoteFileName(note), "f09y-設計メモ.md");
});

test("formatNoteMarkdown and parseNoteMarkdown round-trip", () => {
  const note = {
    id: "note-1794044819984-f09y",
    title: "設計メモ: \"重要\"",
    content: "# 設計メモ\n\nここに本文が入る\n複数行のテスト。",
    updatedAt: 1794046570513
  };

  const md = formatNoteMarkdown(note);
  assert.match(md, /^---\n/);
  assert.match(md, /id: "note-1794044819984-f09y"/);
  assert.match(md, /updatedAt: 1794046570513/);
  assert.match(md, /---/);

  const parsed = parseNoteMarkdown(md);
  assert.equal(parsed.frontMatter.id, note.id);
  assert.equal(parsed.frontMatter.title, note.title);
  assert.equal(parsed.frontMatter.updatedAt, note.updatedAt);
  assert.equal(parsed.content.trim(), note.content.trim());
});

test("parseNoteMarkdown handles md without front matter", () => {
  const raw = "# ただのテキスト\n\nフロントマターなし";
  const parsed = parseNoteMarkdown(raw);
  assert.equal(parsed.frontMatter, null);
  assert.equal(parsed.content, raw);
});

test("往復で id/title/updatedAt/content が保たれる (DB -> md -> DB)", () => {
  const tmp = createTempDir();
  const dbPath = join(tmp, "ura.db");
  const mdDir = join(tmp, "md");

  const { db } = openDb(dbPath);
  try {
    const n1 = addNote(db, "設計メモ\n第1行の本文");
    const n2 = addNote(db, "買い物リスト\nりんご\nバナナ");

    // DB -> md
    const expResult = exportNotesToMd(db, mdDir);
    assert.equal(expResult.total, 2);

    const files = readdirSync(mdDir);
    assert.equal(files.length, 2);

    // 新しい空の DB を用意して md -> DB
    const dbPath2 = join(tmp, "ura2.db");
    const { db: db2 } = openDb(dbPath2);
    try {
      const impResult = importMdToNotes(db2, mdDir);
      assert.equal(impResult.imported, 2);

      const imported1 = getNote(db2, n1.id);
      const imported2 = getNote(db2, n2.id);

      assert.deepEqual(imported1, getNote(db, n1.id));
      assert.deepEqual(imported2, getNote(db, n2.id));
    } finally {
      db2.close();
    }
  } finally {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("変更なしの import は no-op、本文編集は取り込む", () => {
  const tmp = createTempDir();
  const dbPath = join(tmp, "ura.db");
  const mdDir = join(tmp, "md");

  const { db } = openDb(dbPath);
  try {
    const n1 = addNote(db, "初期メモ\n変更なしテスト");
    const initialUpdatedAt = n1.updatedAt;

    exportNotesToMd(db, mdDir);

    // 1回目: 変更なし import は no-op
    const imp1 = importMdToNotes(db, mdDir, { now: initialUpdatedAt + 5000 });
    assert.equal(imp1.unchanged, 1);
    assert.equal(imp1.imported, 0);
    assert.equal(getNote(db, n1.id).updatedAt, initialUpdatedAt);

    // md の本文を編集
    const files = readdirSync(mdDir);
    const mdFile = join(mdDir, files[0]);
    const content = readFileSync(mdFile, "utf8");
    const edited = content.replace("変更なしテスト", "本文を編集しました！");
    writeFileSync(mdFile, edited, "utf8");

    // 2回目: 本文編集を取り込む
    const nowEdit = initialUpdatedAt + 10000;
    const imp2 = importMdToNotes(db, mdDir, { now: nowEdit });
    assert.equal(imp2.imported, 1);
    assert.equal(imp2.unchanged, 0);

    const updatedNote = getNote(db, n1.id);
    assert.ok(updatedNote.updatedAt >= nowEdit);
    assert.match(updatedNote.content, /本文を編集しました！/);
  } finally {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("front matter 無しの md を新規ノートとして取り込み、id を書き戻す", () => {
  const tmp = createTempDir();
  const dbPath = join(tmp, "ura.db");
  const mdDir = join(tmp, "md");

  const { db } = openDb(dbPath);
  try {
    const rawContent = "# 手動で作ったファイル\n\nFront matter はまだありません。";
    const manualFilePath = join(tmp, "md", "manual.md");
    exportNotesToMd(db, mdDir); // ディレクトリ作成

    writeFileSync(manualFilePath, rawContent, "utf8");

    const imp = importMdToNotes(db, mdDir);
    assert.equal(imp.created, 1);

    // ファイルに front matter が書き戻されているか確認
    const updatedFileContent = readFileSync(manualFilePath, "utf8");
    const parsed = parseNoteMarkdown(updatedFileContent);
    assert.ok(parsed.frontMatter);
    assert.ok(parsed.frontMatter.id);
    assert.equal(parsed.frontMatter.title, "# 手動で作ったファイル");

    // DB に正しく登録されているか確認
    const noteInDb = getNote(db, parsed.frontMatter.id);
    assert.ok(noteInDb);
    assert.equal(noteInDb.title, "# 手動で作ったファイル");
    assert.equal(noteInDb.content, rawContent);
  } finally {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("既存ファイルの id→名前を保ち、再 export で重複ファイルを作らない", () => {
  const tmp = createTempDir();
  const dbPath = join(tmp, "ura.db");
  const mdDir = join(tmp, "md");

  const { db } = openDb(dbPath);
  try {
    const n1 = addNote(db, "オリジナルタイトル\n本文");
    exportNotesToMd(db, mdDir);

    const files1 = readdirSync(mdDir);
    assert.equal(files1.length, 1);
    const originalFileName = files1[0];

    // DB 側のタイトルを変更
    db.prepare("UPDATE notes SET title = ? WHERE id = ?").run("変更されたタイトル", n1.id);

    // 再 export: 既存ファイルの id->名前を保つので、新しいファイルを作らず既存ファイルに上書きされる
    exportNotesToMd(db, mdDir);

    const files2 = readdirSync(mdDir);
    assert.equal(files2.length, 1);
    assert.equal(files2[0], originalFileName);

    const text = readFileSync(join(mdDir, originalFileName), "utf8");
    const parsed = parseNoteMarkdown(text);
    assert.equal(parsed.frontMatter.title, "変更されたタイトル");
  } finally {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
