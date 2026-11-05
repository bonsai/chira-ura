import test from "node:test";
import assert from "node:assert/strict";
import { getMonthDir, flushClosedFiles, pushFilesToGitHub } from "../src/wiki-push.js";
import worker from "../src/index.js";

function createMockKV(initialData = {}) {
  const store = new Map(Object.entries(initialData));
  return {
    async list({ cursor } = {}) {
      const keys = Array.from(store.keys()).map(name => ({ name }));
      return { keys, list_complete: true };
    },
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    _store: store
  };
}

test("getMonthDir correctly extracts month", () => {
  assert.equal(getMonthDir("20261105_123456.txt"), "11");
  assert.equal(getMonthDir("無題1_20260415_090000.txt"), "04");
  const timestamp = new Date("2026-07-20T10:00:00Z").getTime();
  assert.equal(getMonthDir("random_file.txt", timestamp), "07");
});

test("flushClosedFiles: processes only closed files into 1 commit and deletes from KV", async () => {
  const kv = createMockKV({
    "20261105_100000.txt": JSON.stringify({
      content: "memo 1 content",
      updatedAt: 1730800000000,
      closed: true
    }),
    "20261105_110000.txt": JSON.stringify({
      content: "memo 2 open draft",
      updatedAt: 1730803600000,
      closed: false
    }),
    "20261105_120000.txt": JSON.stringify({
      content: "memo 3 content",
      updatedAt: 1730807200000,
      closed: true
    })
  });

  const apiCalls = [];
  const mockFetch = async (url, options = {}) => {
    apiCalls.push({ url, options });
    if (url.includes("/git/ref/heads/master") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({ object: { sha: "base_commit_sha_123" } }), { status: 200 });
    }
    if (url.includes("/git/commits/base_commit_sha_123")) {
      return new Response(JSON.stringify({ tree: { sha: "base_tree_sha_456" } }), { status: 200 });
    }
    if (url.includes("/git/trees") && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.base_tree, "base_tree_sha_456");
      assert.equal(body.tree.length, 2);
      assert.equal(body.tree[0].path, "raw/11/20261105_100000.txt");
      assert.equal(body.tree[0].content, "memo 1 content");
      assert.equal(body.tree[1].path, "raw/11/20261105_120000.txt");
      assert.equal(body.tree[1].content, "memo 3 content");
      return new Response(JSON.stringify({ sha: "new_tree_sha_789" }), { status: 201 });
    }
    if (url.includes("/git/commits") && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.tree, "new_tree_sha_789");
      assert.deepEqual(body.parents, ["base_commit_sha_123"]);
      return new Response(JSON.stringify({ sha: "new_commit_sha_abc" }), { status: 201 });
    }
    if (url.includes("/git/ref/heads/master") && options.method === "PATCH") {
      const body = JSON.parse(options.body);
      assert.equal(body.sha, "new_commit_sha_abc");
      return new Response(JSON.stringify({ ref: "refs/heads/master", object: { sha: "new_commit_sha_abc" } }), { status: 200 });
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  const env = {
    INBOX: kv,
    GITHUB_TOKEN: "mock_gh_token_fine_grained"
  };

  const result = await flushClosedFiles({ env, fetchFn: mockFetch });

  assert.equal(result.processed, 2);
  assert.equal(result.deleted, 2);
  assert.equal(result.commitSha, "new_commit_sha_abc");

  // Closed files are deleted, open draft remains in KV
  assert.equal(await kv.get("20261105_100000.txt"), null);
  assert.equal(await kv.get("20261105_120000.txt"), null);
  assert.notEqual(await kv.get("20261105_110000.txt"), null);
});

test("flushClosedFiles: keeps files in KV if GitHub push fails", async () => {
  const kv = createMockKV({
    "20261105_100000.txt": JSON.stringify({
      content: "memo 1 content",
      updatedAt: 1730800000000,
      closed: true
    })
  });

  const mockFailFetch = async (url) => {
    if (url.includes("/git/ref/heads/master")) {
      return new Response("GitHub API Rate Limit / Network Error", { status: 500 });
    }
    return new Response("Error", { status: 500 });
  };

  const env = {
    INBOX: kv,
    GITHUB_TOKEN: "mock_gh_token_fine_grained"
  };

  await assert.rejects(
    async () => {
      await flushClosedFiles({ env, fetchFn: mockFailFetch });
    },
    /Failed to get git ref/
  );

  // File should NOT be deleted from KV
  const item = await kv.get("20261105_100000.txt");
  assert.notEqual(item, null);
});

test("flushClosedFiles: does nothing if no closed files exist", async () => {
  const kv = createMockKV({
    "open_draft.txt": JSON.stringify({
      content: "still editing",
      closed: false
    })
  });

  let fetchCalled = false;
  const mockFetch = async () => {
    fetchCalled = true;
  };

  const env = {
    INBOX: kv,
    GITHUB_TOKEN: "mock_gh_token"
  };

  const result = await flushClosedFiles({ env, fetchFn: mockFetch });
  assert.equal(result.processed, 0);
  assert.equal(result.deleted, 0);
  assert.equal(fetchCalled, false);
});

test("Worker HTTP fetch router and scheduled handler", async () => {
  const kv = createMockKV();
  const env = {
    INBOX: kv,
    API_TOKEN: "test-token",
    GITHUB_TOKEN: "mock_gh_token"
  };

  // 1. PUT unauthorized without token
  const putReqUnauthorized = new Request("https://example.com/inbox/20261105_120000.txt", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "hello world", closed: true })
  });
  const unauthRes = await worker.fetch(putReqUnauthorized, env);
  assert.equal(unauthRes.status, 401);

  // 2. PUT with X-Chira-Token
  const putReq = new Request("https://example.com/inbox/20261105_120000.txt", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Chira-Token": "test-token"
    },
    body: JSON.stringify({ content: "hello world\nline 2", closed: true, updatedAt: 1730800000000 })
  });
  const putRes = await worker.fetch(putReq, env);
  assert.equal(putRes.status, 200);

  // 3. GET /inbox
  const getInboxReq = new Request("https://example.com/inbox", {
    headers: { Authorization: "Bearer test-token" }
  });
  const getInboxRes = await worker.fetch(getInboxReq, env);
  assert.equal(getInboxRes.status, 200);
  const inboxData = await getInboxRes.json();
  assert.equal(inboxData.count, 1);
  assert.equal(inboxData.items[0].name, "20261105_120000.txt");
  assert.equal(inboxData.items[0].title, "hello world");
  assert.equal(inboxData.items[0].closed, true);

  // 4. GET /count
  const getCountReq = new Request("https://example.com/count", {
    headers: { Authorization: "Bearer test-token" }
  });
  const getCountRes = await worker.fetch(getCountReq, env);
  assert.equal(getCountRes.status, 200);
  const countData = await getCountRes.json();
  assert.equal(countData.count, 1);
  assert.equal(countData.lastReceivedAt, new Date(1730800000000).toISOString());
});
