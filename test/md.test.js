import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, addNote, getNote, listNotes } from "../cli/ura-db.js";
import {
  DEFAULT_MD_DIR,
  slugify,
  idSuffix,
  mdFileName,
  toMarkdown,
  parseMarkdown,
  exportMarkdown,
  importMarkdown
} from "../cli/md.js";

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "chira-md-test-"));
  const { db } = openDb(join(dir, "ura.db"));
  t.after(() => {
    try { db.close(); } catch { /* noop */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  });
  return { dir, db, mdDir: join(dir, "md") };
}

test("slugify keeps Japanese and folds spaces/symbols", () => {
  assert.equal(slugify("hello world"), "hello-world");
  assert.equal(slugify("  a  /  b  "), "a-b");
  assert.equal(slugify("設計メモ 2026"), "設計メモ-2026");
  assert.equal(slugify(""), "untitled");
  assert.equal(slugify("a/b:c*d"), "a-b-c-d");
});

test("idSuffix / mdFileName", () => {
  assert.equal(idSuffix("note-1794044819984-f09y"), "f09y");
  assert.equal(idSuffix(""), "0000");
  assert.equal(mdFileName({ id: "note-1-abcd", title: "My Note", content: "" }), "abcd-My-Note.md");
});

test("toMarkdown / parseMarkdown round-trip keeps id/title/updatedAt/content", () => {
  const note = { id: "note-1234-abcd", title: "タイトル", content: "1行目\n2行目\n", updatedAt: 1730000000000 };
  const md = toMarkdown(note);
  assert.match(md, /^---\n/);
  assert.match(md, /id: "note-1234-abcd"/);
  assert.match(md, /title: "タイトル"/);
  assert.match(md, /updatedAt: 1730000000000/);

  const parsed = parseMarkdown(md);
  assert.equal(parsed.id, "note-1234-abcd");
  assert.equal(parsed.title, "タイトル");
  assert.equal(parsed.updatedAt, 1730000000000);
  assert.equal(parsed.content, "1行目\n2行目");
});

test("parseMarkdown without front matter falls back to body title", () => {
  const parsed = parseMarkdown("# 見出し\n本文", "fallback-id");
  assert.equal(parsed.id, "fallback-id");
  assert.equal(parsed.title, "# 見出し");
  assert.equal(parsed.content, "# 見出し\n本文");
});

test("export writes one md per note and import is idempotent", (t) => {
  const { db, mdDir } = setup(t);
  const a = addNote(db, "最初のメモ\n本文A");
  addNote(db, "二つ目\n本文B");

  const out = exportMarkdown(db, mdDir);
  assert.equal(out.count, 2);
  const files = readdirSync(mdDir).filter((f) => f.endsWith(".md"));
  assert.equal(files.length, 2);
  assert.ok(files.some((f) => f.startsWith(idSuffix(a.id) + "-")));

  // 変更なしで取り込み → 変化なし
  const importOut = importMarkdown(db, mdDir);
  assert.equal(importOut.total, 2);
  assert.equal(importOut.changed, 0);
});

test("export/import is a no-op even when content ends with a newline", (t) => {
  const { db, mdDir } = setup(t);
  addNote(db, "末尾改行あり\n本文\n");
  exportMarkdown(db, mdDir);
  const out = importMarkdown(db, mdDir);
  assert.equal(out.changed, 0);
});

test("import picks up an edited body and bumps updatedAt", (t) => {
  const { db, mdDir } = setup(t);
  const note = addNote(db, "編集前\n本文");
  exportMarkdown(db, mdDir);

  const file = join(mdDir, readdirSync(mdDir).find((f) => f.startsWith(idSuffix(note.id))));
  const edited = readFileSync(file, "utf8").replace("本文", "編集後の本文");
  writeFileSync(file, edited, "utf8");

  const before = getNote(db, note.id).updatedAt;
  const out = importMarkdown(db, mdDir);
  assert.equal(out.changed, 1);

  const after = getNote(db, note.id);
  assert.equal(after.content, "編集前\n編集後の本文");
  assert.ok(after.updatedAt >= before);
});

test("import adopts an md file without front matter as a new note", (t) => {
  const { db, mdDir } = setup(t);
  exportMarkdown(db, mdDir);
  writeFileSync(join(mdDir, "loose.md"), "手書きメモ\nfront matter なし\n", "utf8");

  const out = importMarkdown(db, mdDir);
  assert.equal(out.created, 1);
  const notes = listNotes(db).filter((n) => n.content.includes("front matter なし"));
  assert.equal(notes.length, 1);
  assert.ok(notes[0].id.startsWith("note-"));

  // 書き戻されたので 2 度目は新規作成されない
  const again = importMarkdown(db, mdDir);
  assert.equal(again.created, 0);
});

test("DEFAULT_MD_DIR lives under ~/.chira", () => {
  assert.ok(DEFAULT_MD_DIR.includes(".chira"));
  assert.ok(DEFAULT_MD_DIR.endsWith("md"));
});
