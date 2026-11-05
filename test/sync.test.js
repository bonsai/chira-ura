import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDb, addNote, getNote, getUnsyncedNotes, markNoteSynced,
  getInboxSyncMeta, exportCanonical, importCanonical, canonicalSchema
} from "../cli/ura-db.js";
import { syncInbox } from "../cli/cli.js";

function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "chira-sync-test-"));
  const dbPath = join(dir, "ura.db");
  const { db } = openDb(dbPath);
  return {
    dir,
    dbPath,
    db,
    cleanup() {
      try { db.close(); } catch {}
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  };
}

test("syncInbox sends unpushed notes to /inbox as note JSON", async (t) => {
  const { db, cleanup } = setupTestDb();
  t.after(cleanup);

  const n1 = addNote(db, "Note 1 title\nBody content 1");
  const n2 = addNote(db, "Note 2 title\nBody content 2");

  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: JSON.parse(body)
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await syncInbox(db, {
    apiUrl: `http://127.0.0.1:${port}`,
    token: "test-token-123"
  });

  assert.equal(result.ok, true);
  assert.equal(result.sent, 2);
  assert.equal(received.length, 2);

  // Check received files & payload format
  const req1 = received.find((r) => r.url === `/inbox/${n1.id}.txt`);
  assert.ok(req1, "PUT request for n1.id.txt exists");
  assert.equal(req1.method, "PUT");
  assert.equal(req1.headers["authorization"], "Bearer test-token-123");
  assert.equal(req1.headers["x-chira-token"], "test-token-123");
  assert.equal(req1.body.id, n1.id);
  assert.equal(req1.body.title, n1.title);
  assert.equal(req1.body.content, n1.content);
  assert.equal(req1.body.updatedAt, n1.updatedAt);

  const req2 = received.find((r) => r.url === `/inbox/${n2.id}.txt`);
  assert.ok(req2, "PUT request for n2.id.txt exists");
  assert.equal(req2.body.id, n2.id);

  // Check sync meta recorded in DB
  const syncMeta = getInboxSyncMeta(db);
  assert.equal(syncMeta[n1.id], n1.updatedAt);
  assert.equal(syncMeta[n2.id], n2.updatedAt);
  assert.equal(getUnsyncedNotes(db).length, 0);
});

test("syncInbox is idempotent on re-execution (no duplicates)", async (t) => {
  const { db, cleanup } = setupTestDb();
  t.after(cleanup);

  const n = addNote(db, "Unique note");
  let requestCount = 0;
  const server = createServer((req, res) => {
    requestCount++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  // First sync
  const res1 = await syncInbox(db, { apiUrl: `http://127.0.0.1:${port}` });
  assert.equal(res1.ok, true);
  assert.equal(res1.sent, 1);
  assert.equal(requestCount, 1);

  // Second sync: should send 0 because note hasn't changed
  const res2 = await syncInbox(db, { apiUrl: `http://127.0.0.1:${port}` });
  assert.equal(res2.ok, true);
  assert.equal(res2.sent, 0);
  assert.equal(requestCount, 1);
});

test("canonical export/import remains compatible and intact", async (t) => {
  const { db, dir, cleanup } = setupTestDb();
  t.after(cleanup);

  const n = addNote(db, "Canonical note test");
  markNoteSynced(db, n.id, n.updatedAt);

  const canonicalDir = join(dir, "canonical");
  exportCanonical(db, canonicalDir);

  const schema = canonicalSchema(db);
  assert.match(schema, /CREATE TABLE (IF NOT EXISTS )?notes/);
  assert.match(schema, /CREATE TABLE (IF NOT EXISTS )?meta/);

  // Test re-importing canonical into fresh DB
  const { dir: dir2, db: db2, cleanup: cleanup2 } = setupTestDb();
  t.after(cleanup2);

  const imported = importCanonical(db2, canonicalDir);
  assert.ok(imported.total >= 1);
  assert.equal(getNote(db2, n.id).title, n.title);
  assert.equal(getInboxSyncMeta(db2)[n.id], n.updatedAt);
});

test("offline / network failure fails silently and retains unsynced status", async (t) => {
  const { db, cleanup } = setupTestDb();
  t.after(cleanup);

  const n = addNote(db, "Offline note");

  // Choose a port where no server is listening
  const deadUrl = "http://127.0.0.1:59999";
  const res = await syncInbox(db, { apiUrl: deadUrl });

  assert.equal(res.ok, false);
  assert.equal(res.sent, 0);
  assert.equal(res.reason, "network_error");

  // Note must still be unsynced so next run can retry
  const unsynced = getUnsyncedNotes(db);
  assert.equal(unsynced.length, 1);
  assert.equal(unsynced[0].id, n.id);
});
