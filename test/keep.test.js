import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import {
  toEpochMs,
  keepContent,
  keepToNote,
  parseKeepJson,
  parseKeepHtml,
  readKeepTakeout,
  zipEntries
} from "../cli/keep.js";
import { openDb, listNotes, getNote } from "../cli/ura-db.js";

function buildSimpleZip(entries) {
  // entries: [{ name, data (Buffer) }]
  let localHeaders = [];
  let centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const rawData = entry.data;
    const deflated = deflateRawSync(rawData);
    const method = 8; // deflate
    const compSize = deflated.length;
    const uncompSize = rawData.length;

    // local file header (30 bytes + nameLen)
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // local sig
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8); // method
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(0, 14); // crc32 (mocked/not checked)
    local.writeUInt32LE(compSize, 18);
    local.writeUInt32LE(uncompSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    nameBuf.copy(local, 30);

    const localEntry = Buffer.concat([local, deflated]);
    localHeaders.push(localEntry);

    // central directory header (46 bytes + nameLen)
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); // cd sig
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(0, 16); // crc32
    cd.writeUInt32LE(compSize, 20);
    cd.writeUInt32LE(uncompSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra len
    cd.writeUInt16LE(0, 32); // comment len
    cd.writeUInt16LE(0, 34); // disk start
    cd.writeUInt16LE(0, 36); // internal attr
    cd.writeUInt32LE(0, 38); // external attr
    cd.writeUInt32LE(offset, 42); // local header offset
    nameBuf.copy(cd, 46);

    centralHeaders.push(cd);
    offset += localEntry.length;
  }

  const centralDir = Buffer.concat(centralHeaders);
  const cdOffset = offset;
  const cdSize = centralDir.length;

  // EOCD (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk num
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(entries.length, 8); // disk entries
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localHeaders, centralDir, eocd]);
}

test("toEpochMs: µs, ms, ISO文字列を正しくミリ秒に変換する", () => {
  assert.equal(toEpochMs(1700000000000000), 1700000000000); // µs
  assert.equal(toEpochMs("1700000000000000"), 1700000000000); // string µs
  assert.equal(toEpochMs(1700000000000), 1700000000000); // ms
  assert.equal(toEpochMs("2026-10-22T08:00:00.000Z"), Date.parse("2026-10-22T08:00:00.000Z"));
  assert.equal(toEpochMs(null), 0);
  assert.equal(toEpochMs("invalid"), 0);
});

test("keepContent / keepToNote: textContent, lists, annotations の結合とタイトル導出", () => {
  const keep = {
    id: "keep-1",
    title: "",
    textContent: "First line of note\nSecond line",
    lists: [
      { title: "Task 1", isChecked: true },
      { title: "Task 2", isChecked: false }
    ],
    annotations: [
      { title: "Google", url: "https://google.com" },
      { title: "https://example.com", url: "https://example.com" }
    ],
    userEditedTimestampUsec: 1700000000000000
  };

  const note = keepToNote(keep);
  assert.equal(note.id, "keep-1");
  assert.equal(note.title, "First line of note"); // 本文1行目から導出
  assert.ok(note.content.includes("First line of note\nSecond line"));
  assert.ok(note.content.includes("- [x] Task 1"));
  assert.ok(note.content.includes("- [ ] Task 2"));
  assert.ok(note.content.includes("Google: https://google.com"));
  assert.ok(note.content.includes("https://example.com"));
  assert.equal(note.updatedAt, 1700000000000);
});

test("parseKeepJson: trashed のフィルタと配列パース", () => {
  const jsonStr = JSON.stringify([
    { id: "note-1", textContent: "Active note", userEditedTimestampUsec: 1700000000000000 },
    { id: "note-2", textContent: "Trashed note", trashed: true, userEditedTimestampUsec: 1700000001000000 }
  ]);

  const raw = parseKeepJson(jsonStr);
  assert.equal(raw.length, 2);

  const tmp = mkdtempSync(join(tmpdir(), "chira-keep-json-"));
  try {
    const jsonPath = join(tmp, "Notes.json");
    writeFileSync(jsonPath, jsonStr, "utf8");

    // 既定: trashed 除外
    const resWithoutTrash = readKeepTakeout(jsonPath);
    assert.equal(resWithoutTrash.notes.length, 1);
    assert.equal(resWithoutTrash.skipped, 1);
    assert.equal(resWithoutTrash.notes[0].id, "note-1");

    // --trash: trashed 含む
    const resWithTrash = readKeepTakeout(jsonPath, { includeTrash: true });
    assert.equal(resWithTrash.notes.length, 2);
    assert.equal(resWithTrash.skipped, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("parseKeepHtml: HTML からのタイトル・本文抽出と実体参照デコード", () => {
  const html = `
    <div class="note">
      <div class="title">HTML Note &amp; Title</div>
      <div class="content">Line 1<br>Line 2<p>Paragraph</p>&quot;quoted&quot;</div>
    </div>
  `;
  const notes = parseKeepHtml(html);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "HTML Note & Title");
  assert.ok(notes[0].content.includes("Line 1\nLine 2"));
  assert.ok(notes[0].content.includes('"quoted"'));
  assert.ok(notes[0].id.startsWith("keep-"));
});

test("zipEntries / readKeepTakeout: zip ファイルからの Notes.json / Notes.html 読み出し", () => {
  const jsonContent = JSON.stringify([
    { id: "keep-zip-1", textContent: "Hello from Zip", userEditedTimestampUsec: 1700000000000000 }
  ]);
  const zipBuf = buildSimpleZip([
    { name: "Takeout/Keep/Notes.json", data: Buffer.from(jsonContent, "utf8") }
  ]);

  const entries = zipEntries(zipBuf);
  assert.ok(entries.has("Takeout/Keep/Notes.json"));

  const tmp = mkdtempSync(join(tmpdir(), "chira-keep-zip-"));
  try {
    const zipPath = join(tmp, "takeout-test.zip");
    writeFileSync(zipPath, zipBuf);

    const res = readKeepTakeout(zipPath);
    assert.equal(res.notes.length, 1);
    assert.equal(res.notes[0].id, "keep-zip-1");
    assert.equal(res.notes[0].content, "Hello from Zip");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("SQLite 取り込み: 再取り込みで上書き・重複しない（冪等性）", () => {
  const tmp = mkdtempSync(join(tmpdir(), "chira-keep-db-"));
  try {
    const dbPath = join(tmp, "ura.db");
    const { db } = openDb(dbPath);

    const keep1 = {
      id: "keep-dedup",
      title: "Keep Title",
      textContent: "Original content",
      userEditedTimestampUsec: 1700000000000000
    };
    const note1 = keepToNote(keep1);

    // 1回目の取り込み
    const jsonPath = join(tmp, "Notes.json");
    writeFileSync(jsonPath, JSON.stringify([keep1]), "utf8");

    const cliPath = join(process.cwd(), "cli", "cli.js");
    execFileSync(process.execPath, [cliPath, "keep", "import", jsonPath], {
      env: { ...process.env, CHIRA_DB: dbPath }
    });

    const rows1 = listNotes(db);
    assert.equal(rows1.length, 1);
    assert.equal(rows1[0].content, "Original content");

    // 2回目: 同一 id で更新内容を取り込み
    const keep2 = {
      id: "keep-dedup",
      title: "Keep Title Updated",
      textContent: "Updated content",
      userEditedTimestampUsec: 1700000005000000
    };
    writeFileSync(jsonPath, JSON.stringify([keep2]), "utf8");

    execFileSync(process.execPath, [cliPath, "keep", "import", jsonPath], {
      env: { ...process.env, CHIRA_DB: dbPath }
    });

    const rows2 = listNotes(db);
    assert.equal(rows2.length, 1); // 件数は増えない（重複なし）
    assert.equal(rows2[0].id, "keep-dedup");
    assert.equal(rows2[0].title, "Keep Title Updated");
    assert.equal(rows2[0].content, "Updated content");
    assert.equal(rows2[0].updatedAt, 1700000005000);

    // chira export で JSONL 出力できることの確認
    const exportFile = join(tmp, "notes.jsonl");
    execFileSync(process.execPath, [cliPath, "export", exportFile], {
      env: { ...process.env, CHIRA_DB: dbPath }
    });
    const exportedNote = getNote(db, "keep-dedup");
    assert.ok(exportedNote);

    db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
