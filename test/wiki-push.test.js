import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDb, addNote, getNote, getUnsyncedWikiNotes, markNoteWikiSynced,
  getWikiSyncMeta, exportCanonical, importCanonical
} from "../cli/ura-db.js";
import {
  formatTimestampFilename, getMonthDir, pushNotesToWiki, syncWiki
} from "../cli/wiki-push.js";

function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "chira-wiki-test-"));
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

test("formatTimestampFilename formats correctly and getMonthDir extracts month", () => {
  const ts = new Date("2026-04-15T12:34:56Z").getTime();
  const filename = formatTimestampFilename(ts);
  assert.match(filename, /^\d{8}_\d{6}\.txt$/);

  const mm = getMonthDir(filename, ts);
  assert.equal(mm.length, 2);
  assert.match(mm, /^\d{2}$/);
});

test("pushNotesToWiki: pushes notes to raw/<MM>/ in 1 single commit", async () => {
  const notes = [
    {
      id: "n1",
      title: "Note 1",
      content: "Content 1",
      updatedAt: new Date("2026-04-15T12:00:00Z").getTime()
    },
    {
      id: "n2",
      title: "Note 2",
      content: "Content 2",
      updatedAt: new Date("2026-05-20T15:30:00Z").getTime()
    }
  ];

  const requests = [];
  const fakeFetch = async (url, opts = {}) => {
    requests.push({ url, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });

    if (url.includes("/git/ref/heads/")) {
      return {
        ok: true,
        json: async () => ({ object: { sha: "head-commit-sha-123" } }),
        text: async () => ""
      };
    }
    if (url.includes("/git/commits/head-commit-sha-123")) {
      return {
        ok: true,
        json: async () => ({ tree: { sha: "base-tree-sha-456" } }),
        text: async () => ""
      };
    }
    if (url.endsWith("/git/trees")) {
      assert.equal(opts.body ? JSON.parse(opts.body).base_tree : null, "base-tree-sha-456");
      const tree = JSON.parse(opts.body).tree;
      assert.equal(tree.length, 2);
      assert.match(tree[0].path, /^raw\/\d{2}\/\d{8}_\d{6}\.txt$/);
      assert.match(tree[1].path, /^raw\/\d{2}\/\d{8}_\d{6}\.txt$/);
      return {
        ok: true,
        json: async () => ({ sha: "new-tree-sha-789" }),
        text: async () => ""
      };
    }
    if (url.endsWith("/git/commits")) {
      const body = JSON.parse(opts.body);
      assert.match(body.message, /^chore\(wiki\): archive 2 memo\(s\)/);
      assert.equal(body.tree, "new-tree-sha-789");
      assert.deepEqual(body.parents, ["head-commit-sha-123"]);
      return {
        ok: true,
        json: async () => ({ sha: "new-commit-sha-abc" }),
        text: async () => ""
      };
    }
    return { ok: true, json: async () => ({}), text: async () => "" };
  };

  const res = await pushNotesToWiki({
    notes,
    owner: "bonsai",
    repo: "wiki",
    branch: "master",
    token: "mock-gh-token",
    fetchFn: fakeFetch
  });

  assert.equal(res.commitSha, "new-commit-sha-abc");
  assert.equal(res.count, 2);
  assert.equal(requests.length, 5); // ref get, commit get, tree post, commit post, ref patch
});

test("syncWiki: marks notes as synced and is idempotent", async (t) => {
  const { db, cleanup } = setupTestDb();
  t.after(cleanup);

  const n1 = addNote(db, "Wiki note 1");
  const n2 = addNote(db, "Wiki note 2");

  let pushCalled = 0;
  const fakeFetch = async (url, opts = {}) => {
    if (url.endsWith("/git/commits") && opts.method === "POST") {
      pushCalled++;
      return {
        ok: true,
        json: async () => ({ sha: "commit-sha-" + pushCalled }),
        text: async () => ""
      };
    }
    if (url.includes("/git/ref/heads/")) {
      return { ok: true, json: async () => ({ object: { sha: "head-sha" } }), text: async () => "" };
    }
    if (url.includes("/git/commits/head-sha")) {
      return { ok: true, json: async () => ({ tree: { sha: "base-tree-sha" } }), text: async () => "" };
    }
    if (url.endsWith("/git/trees")) {
      return { ok: true, json: async () => ({ sha: "tree-sha" }), text: async () => "" };
    }
    return { ok: true, json: async () => ({}), text: async () => "" };
  };

  // 1. Initial sync
  const res1 = await syncWiki(db, {
    token: "mock-token",
    fetchFn: fakeFetch
  });
  assert.equal(res1.ok, true);
  assert.equal(res1.sent, 2);
  assert.equal(res1.commitSha, "commit-sha-1");
  assert.equal(pushCalled, 1);

  // Meta check
  const meta = getWikiSyncMeta(db);
  assert.equal(meta[n1.id], n1.updatedAt);
  assert.equal(meta[n2.id], n2.updatedAt);
  assert.equal(getUnsyncedWikiNotes(db).length, 0);

  // 2. Second sync with no new notes -> sent: 0, no push call
  const res2 = await syncWiki(db, {
    token: "mock-token",
    fetchFn: fakeFetch
  });
  assert.equal(res2.ok, true);
  assert.equal(res2.sent, 0);
  assert.equal(pushCalled, 1);
});

test("syncWiki: offline / error keeps notes in SQLite for next retry", async (t) => {
  const { db, cleanup } = setupTestDb();
  t.after(cleanup);

  const n = addNote(db, "Offline wiki note");

  const failingFetch = async () => {
    throw new Error("DNS resolution failure");
  };

  const res = await syncWiki(db, {
    token: "mock-token",
    fetchFn: failingFetch
  });

  assert.equal(res.ok, false);
  assert.equal(res.sent, 0);
  assert.equal(res.reason, "network_error");

  // Note must still be unsynced
  const unsynced = getUnsyncedWikiNotes(db);
  assert.equal(unsynced.length, 1);
  assert.equal(unsynced[0].id, n.id);
});
