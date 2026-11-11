import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { openDb, getNote, listNotes } from "../cli/ura-db.js";
import {
  normalizeTimestamp,
  wikiToNote,
  compareWikiFileNames,
  collectWikiFiles,
  readWikiNotes,
  importWikiNotes,
  listWikiNotes
} from "../cli/wiki-import.js";

test("normalizeTimestamp: converts various date formats to milliseconds", () => {
  const now = Date.now();
  // ms number
  assert.equal(normalizeTimestamp(1761100000000), 1761100000000);
  // seconds number
  assert.equal(normalizeTimestamp(1761100000), 1761100000000);
  // numeric string
  assert.equal(normalizeTimestamp("1761100000000"), 1761100000000);
  assert.equal(normalizeTimestamp("1761100000"), 1761100000000);
  // ISO date string
  assert.equal(normalizeTimestamp("2026-10-22T10:00:00Z"), Date.parse("2026-10-22T10:00:00Z"));
  // invalid / empty fallback
  assert.equal(normalizeTimestamp("", now), now);
  assert.equal(normalizeTimestamp(null, now), now);
  assert.equal(normalizeTimestamp("invalid-date", now), now);
});

test("wikiToNote: converts wiki object with various schema attributes to chira-ura note", () => {
  // Case 1: content + title + updatedAt
  const note1 = wikiToNote({
    id: "custom-id-1",
    title: "Explicit Title",
    content: "First line\nSecond line",
    updatedAt: 1761100000000
  });
  assert.deepEqual(note1, {
    id: "custom-id-1",
    title: "Explicit Title",
    content: "First line\nSecond line",
    updatedAt: 1761100000000
  });

  // Case 2: body instead of content, createdAt instead of updatedAt, title derived from first line
  const note2 = wikiToNote({
    body: "First line heading\nMore details here",
    createdAt: "2026-10-22T08:30:00Z"
  });
  assert.ok(note2.id.startsWith("note-"));
  assert.equal(note2.title, "First line heading");
  assert.equal(note2.content, "First line heading\nMore details here");
  assert.equal(note2.updatedAt, Date.parse("2026-10-22T08:30:00Z"));

  // Case 3: text instead of content, updated instead of updatedAt
  const note3 = wikiToNote({
    text: "Short text note",
    updated: 1761100000
  });
  assert.equal(note3.title, "Short text note");
  assert.equal(note3.content, "Short text note");
  assert.equal(note3.updatedAt, 1761100000000);

  // Case 4: empty content defaults to empty string and 無題
  const note4 = wikiToNote({});
  assert.equal(note4.title, "無題");
  assert.equal(note4.content, "");
  assert.ok(typeof note4.updatedAt === "number");
});

test("compareWikiFileNames: sorts chronological dates properly", () => {
  const files = [
    "2026-10-25-memo.json",
    "2026-10-22-start.json",
    "2026-10-22-sub.json",
    "notes.jsonl",
    "2026-10-21-old.json",
    "other.json"
  ];

  files.sort(compareWikiFileNames);

  assert.deepEqual(files, [
    "2026-10-21-old.json",
    "2026-10-22-start.json",
    "2026-10-22-sub.json",
    "2026-10-25-memo.json",
    "notes.jsonl",
    "other.json"
  ]);
});

test("importWikiNotes and listWikiNotes: directory and file import into SQLite", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "chira-wiki-test-"));
  const dbPath = join(tempDir, "test.db");

  try {
    const wikiDir = join(tempDir, "wiki");
    mkdirSync(wikiDir);

    // Write a .json file (single note)
    writeFileSync(
      join(wikiDir, "2026-10-22-note1.json"),
      JSON.stringify({
        id: "wiki-note-1",
        title: "Wiki Note 1",
        content: "Content 1",
        updatedAt: 1761100000000
      }, null, 2),
      "utf8"
    );

    // Write another .json with body & createdAt
    writeFileSync(
      join(wikiDir, "2026-10-23-note2.json"),
      JSON.stringify({
        id: "wiki-note-2",
        body: "Body from note 2",
        createdAt: "2026-10-23T12:00:00Z"
      }, null, 2),
      "utf8"
    );

    // Write a .jsonl file (multiple notes)
    const jsonlLines = [
      JSON.stringify({ id: "wiki-note-3", title: "Wiki Note 3", text: "Text in line 1", updatedAt: 1761100010000 }),
      "{ invalid json line }",
      JSON.stringify({ id: "wiki-note-4", text: "Text in line 2\nLine 2 details", updated: 1761100020 })
    ].join("\n") + "\n";
    writeFileSync(join(wikiDir, "notes.jsonl"), jsonlLines, "utf8");

    // Also write a non-json file that should be ignored in directory
    writeFileSync(join(wikiDir, "readme.txt"), "ignored", "utf8");

    // Test listWikiNotes (dry run, does not touch DB)
    const listResult = listWikiNotes(wikiDir);
    assert.equal(listResult.length, 4);
    assert.equal(listResult[0].id, "wiki-note-1");
    assert.equal(listResult[1].id, "wiki-note-2");
    assert.equal(listResult[2].id, "wiki-note-3");
    assert.equal(listResult[3].id, "wiki-note-4");

    // Test importWikiNotes into SQLite DB
    const { db } = openDb(dbPath);
    try {
      const res1 = importWikiNotes(db, wikiDir);
      assert.equal(res1.total, 4);
      assert.equal(res1.imported, 4);

      const saved1 = getNote(db, "wiki-note-1");
      assert.equal(saved1.title, "Wiki Note 1");
      assert.equal(saved1.content, "Content 1");
      assert.equal(saved1.updatedAt, 1761100000000);

      const saved2 = getNote(db, "wiki-note-2");
      assert.equal(saved2.title, "Body from note 2");
      assert.equal(saved2.content, "Body from note 2");
      assert.equal(saved2.updatedAt, Date.parse("2026-10-23T12:00:00Z"));

      const saved4 = getNote(db, "wiki-note-4");
      assert.equal(saved4.title, "Text in line 2");
      assert.equal(saved4.content, "Text in line 2\nLine 2 details");
      assert.equal(saved4.updatedAt, 1761100020000);

      // Overwrite test: same id overwrites existing note
      writeFileSync(
        join(wikiDir, "2026-10-22-note1.json"),
        JSON.stringify({
          id: "wiki-note-1",
          title: "Wiki Note 1 Updated",
          content: "Updated Content 1",
          updatedAt: 1761100099000
        }, null, 2),
        "utf8"
      );

      const res2 = importWikiNotes(db, wikiDir);
      assert.equal(res2.total, 4);
      const updated1 = getNote(db, "wiki-note-1");
      assert.equal(updated1.title, "Wiki Note 1 Updated");
      assert.equal(updated1.content, "Updated Content 1");
      assert.equal(updated1.updatedAt, 1761100099000);

      // Single file import test
      const singleJsonl = join(tempDir, "single.jsonl");
      writeFileSync(
        singleJsonl,
        JSON.stringify({ id: "single-1", text: "Single file note", updatedAt: 1761199999000 }) + "\n",
        "utf8"
      );
      const resSingle = importWikiNotes(db, singleJsonl);
      assert.equal(resSingle.total, 1);
      assert.equal(resSingle.imported, 1);
      assert.equal(getNote(db, "single-1").content, "Single file note");
    } finally {
      db.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI commands: chira wiki list and chira wiki import via CLI execution", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "chira-cli-test-"));
  const dbPath = join(tempDir, "ura.db");
  const cliPath = join(process.cwd(), "cli", "cli.js");

  try {
    const wikiDir = join(tempDir, "wiki");
    mkdirSync(wikiDir);

    writeFileSync(
      join(wikiDir, "2026-10-22-test.json"),
      JSON.stringify({
        id: "cli-note-1",
        title: "CLI Note",
        content: "CLI content line",
        updatedAt: 1761100000000
      }),
      "utf8"
    );

    // Run chira wiki list <wikiDir>
    const listOut = execFileSync(process.execPath, [cliPath, "wiki", "list", wikiDir], {
      env: { ...process.env, CHIRA_DB: dbPath },
      encoding: "utf8"
    });
    assert.match(listOut, /cli-note-1/);
    assert.match(listOut, /CLI Note/);

    // Run chira wiki import <wikiDir>
    const importOut = execFileSync(process.execPath, [cliPath, "wiki", "import", wikiDir], {
      env: { ...process.env, CHIRA_DB: dbPath },
      encoding: "utf8"
    });
    assert.match(importOut, /imported: 1\/1 notes/);

    // Verify it is in the database using chira note get cli-note-1
    const getOut = execFileSync(process.execPath, [cliPath, "note", "get", "cli-note-1"], {
      env: { ...process.env, CHIRA_DB: dbPath },
      encoding: "utf8"
    });
    const parsed = JSON.parse(getOut);
    assert.equal(parsed.id, "cli-note-1");
    assert.equal(parsed.title, "CLI Note");
    assert.equal(parsed.content, "CLI content line");

    // Test chira export notes.jsonl
    const exportFile = join(tempDir, "notes.jsonl");
    execFileSync(process.execPath, [cliPath, "export", exportFile], {
      env: { ...process.env, CHIRA_DB: dbPath },
      encoding: "utf8"
    });
    const exportOut = execFileSync(process.execPath, [cliPath, "export"], {
      env: { ...process.env, CHIRA_DB: dbPath },
      encoding: "utf8"
    });
    assert.match(exportOut, /"id":"cli-note-1"/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
