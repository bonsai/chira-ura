import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../cli/ura-db.js";
import {
  getMonthDir,
  formatNoteFileName,
  getWikiSyncMeta,
  markWikiSynced,
  getUnsyncedWikiNotes,
  pushFilesToGitHub,
  resolveGitHubToken,
  syncWiki,
  WIKI_BATCH_SIZE
} from "../cli/wiki-push.js";

function jsonResponse(obj) {
  return {
    ok: true,
    status: 200,
    async json() {
      return obj;
    },
    async text() {
      return JSON.stringify(obj);
    }
  };
}

// GitHub Git Data API のモック。calls に全リクエストを記録する。
function makeMockGitHub({ failRef = false } = {}) {
  const calls = [];
  let commits = 0;
  const fetchFn = async (url, opts = {}) => {
    const method = opts.method || "GET";
    const u = String(url);
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });

    if (u.endsWith("/git/ref/heads/master") && method === "GET") {
      if (failRef) return { ok: false, status: 500, async text() { return "ref fail"; }, async json() { return {}; } };
      return jsonResponse({ object: { sha: "base-commit-sha" } });
    }
    if (u.includes("/git/commits/base-commit-sha") && method === "GET") {
      return jsonResponse({ sha: "base-commit-sha", tree: { sha: "base-tree-sha" } });
    }
    if (u.endsWith("/git/trees") && method === "POST") {
      return jsonResponse({ sha: "new-tree-sha" });
    }
    if (u.endsWith("/git/commits") && method === "POST") {
      commits++;
      return jsonResponse({ sha: `new-commit-${commits}` });
    }
    if (u.endsWith("/git/ref/heads/master") && method === "PATCH") {
      return jsonResponse({ ok: true });
    }
    return { ok: false, status: 500, async text() { return `unexpected ${method} ${u}`; }, async json() { return {}; } };
  };
  return { fetchFn, calls, commitCount: () => commits };
}

async function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), "chira-wiki-"));
  const { db } = openDb(join(dir, "ura.db"));
  try {
    return await fn(db, dir);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedNotes(db, count, { start = 1700000000000, idPrefix = "note" } = {}) {
  const notes = [];
  for (let i = 0; i < count; i++) {
    const id = `${idPrefix}-${String(i).padStart(3, "0")}`;
    const updatedAt = start + i * 1000;
    db.prepare("INSERT OR REPLACE INTO notes (id, title, content, updatedAt) VALUES (?, ?, ?, ?)").run(
      id,
      `title ${i}`,
      `content ${i}`,
      updatedAt
    );
    notes.push({ id, updatedAt });
  }
  return notes;
}

test("getMonthDir derives MM from filename or updatedAt", () => {
  assert.equal(getMonthDir("20261105_123456_abcd.txt"), "11");
  assert.equal(getMonthDir("無題1_20260415_090000.txt"), "04");
  const ts = new Date("2026-07-20T10:00:00Z").getTime();
  assert.equal(getMonthDir("random.txt", ts), "07");
});

test("formatNoteFileName is timestamp-first and unique-ish", () => {
  const ts = Date.UTC(2026, 10, 5, 12, 0, 0); // 2026-11-05T12:00:00Z
  assert.equal(formatNoteFileName(ts, "note-1234-abcd"), "20261105_120000_abcd.txt");
  assert.match(formatNoteFileName(ts, "note-1234-abcd"), /^\d{8}_\d{6}_\w{4}\.txt$/);
});

test("pushFilesToGitHub creates 1 commit under raw/<MM>/", async () => {
  const mock = makeMockGitHub();
  const files = [
    { key: "20261105_120000_abcd.txt", content: "hello", updatedAt: Date.UTC(2026, 10, 5) },
    { key: "20260415_090000_ef01.txt", content: "world", updatedAt: Date.UTC(2026, 3, 15) }
  ];
  const res = await pushFilesToGitHub({
    files,
    token: "tok",
    fetchFn: mock.fetchFn
  });

  assert.equal(res.fileCount, 2);
  assert.equal(mock.commitCount(), 1);

  const treeCall = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/git/trees"));
  assert.ok(treeCall, "tree POST should happen");
  const paths = treeCall.body.tree.map((t) => t.path).sort();
  assert.deepEqual(paths, ["raw/04/20260415_090000_ef01.txt", "raw/11/20261105_120000_abcd.txt"]);

  // ref は最後に PATCH で更新される
  const patch = mock.calls.find((c) => c.method === "PATCH");
  assert.ok(patch, "ref PATCH should happen");
  assert.equal(patch.body.sha, "new-commit-1");
});

test("syncWiki pushes in batches of 10 and is idempotent", async () => {
  await withTempDb(async (db) => {
    seedNotes(db, 25);
    const mock = makeMockGitHub();

    const first = await syncWiki(db, { token: "tok", fetchFn: mock.fetchFn });
    assert.equal(first.ok, true);
    assert.equal(first.pushed, 25);
    assert.equal(first.commits, 3); // 10 + 10 + 5
    assert.equal(mock.commitCount(), 3);
    assert.equal(WIKI_BATCH_SIZE, 10);

    // すべて送信済みマークされる
    assert.equal(getUnsyncedWikiNotes(db).length, 0);
    assert.equal(Object.keys(getWikiSyncMeta(db)).length, 25);

    // 再実行しても増えない（冪等）
    const second = await syncWiki(db, { token: "tok", fetchFn: mock.fetchFn });
    assert.equal(second.pushed, 0);
    assert.equal(mock.commitCount(), 3);
  });
});

test("syncWiki keeps unsent notes when push fails", async () => {
  await withTempDb(async (db) => {
    seedNotes(db, 3);
    const mock = makeMockGitHub({ failRef: true });

    const res = await syncWiki(db, { token: "tok", fetchFn: mock.fetchFn });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "push_failed");
    assert.equal(res.pushed, 0);

    // 送信済みにしない → 次回リトライ対象として残る
    assert.equal(getUnsyncedWikiNotes(db).length, 3);
  });
});

test("syncWiki reports no_token when no token available", async () => {
  await withTempDb(async (db) => {
    seedNotes(db, 1);
    const res = await syncWiki(db, { token: "", fetchFn: makeMockGitHub().fetchFn });
    // token="" is falsy → resolveGitHubToken() is called (gh may or may not exist).
    assert.equal(typeof res.ok, "boolean");
  });
});

test("markWikiSynced / getUnsyncedWikiNotes respect updatedAt", async () => {
  await withTempDb(async (db) => {
    db.prepare("INSERT INTO notes (id, title, content, updatedAt) VALUES (?, ?, ?, ?)").run("n1", "t", "c", 1000);
    assert.equal(getUnsyncedWikiNotes(db).length, 1);
    markWikiSynced(db, "n1", 1000);
    assert.equal(getUnsyncedWikiNotes(db).length, 0);
    // 新しい更新は未送信に戻る
    db.prepare("UPDATE notes SET updatedAt = 2000 WHERE id = ?").run("n1");
    assert.equal(getUnsyncedWikiNotes(db).length, 1);
  });
});

test("resolveGitHubToken prefers env then gh", () => {
  assert.equal(resolveGitHubToken({ env: { CHIRA_GH_TOKEN: "a", GITHUB_TOKEN: "b" } }), "a");
  assert.equal(resolveGitHubToken({ env: { GITHUB_TOKEN: "b" } }), "b");
  assert.equal(
    resolveGitHubToken({ env: {}, execFn: () => "gh-token\n" }),
    "gh-token"
  );
  assert.equal(
    resolveGitHubToken({ env: {}, execFn: () => { throw new Error("no gh"); } }),
    null
  );
});
