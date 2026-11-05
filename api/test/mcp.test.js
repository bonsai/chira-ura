import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { handleMcpRequest, TOOLS } from "../src/mcp.js";

function createMockKV(initialData = {}) {
  const store = new Map(Object.entries(initialData));
  return {
    async get(key) {
      return store.get(key) || null;
    },
    async put(key, val) {
      store.set(key, val);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ cursor } = {}) {
      const keys = Array.from(store.keys()).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
    _store: store
  };
}

test("MCP: Authentication check on /mcp", async () => {
  const env = {
    API_TOKEN: "secret-token-123",
    INBOX: createMockKV()
  };

  // Unauthorized request
  const unauthReq = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  const unauthRes = await worker.fetch(unauthReq, env, {});
  assert.equal(unauthRes.status, 401);

  // Authorized via Bearer
  const authReq1 = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer secret-token-123"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  const authRes1 = await worker.fetch(authReq1, env, {});
  assert.equal(authRes1.status, 200);

  // Authorized via X-Chira-Token
  const authReq2 = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Chira-Token": "secret-token-123"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  const authRes2 = await worker.fetch(authReq2, env, {});
  assert.equal(authRes2.status, 200);
});

test("MCP: server/discover and initialize", async () => {
  const env = { INBOX: createMockKV() };

  // server/discover
  const req1 = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "server/discover" })
  });
  const res1 = await worker.fetch(req1, env, {});
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.id, 10);
  assert.equal(data1.result.serverInfo.name, "chira-mcp");
  assert.ok(data1.result.capabilities.tools);
  assert.ok(data1.result.supportedVersions.includes("2026-07-28"));

  // initialize
  const req2 = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "initialize" })
  });
  const res2 = await worker.fetch(req2, env, {});
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.id, 11);
  assert.equal(data2.result.serverInfo.name, "chira-mcp");
});

test("MCP: tools/list lists all 6 tools", async () => {
  const env = { INBOX: createMockKV() };
  const req = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 20, method: "tools/list" })
  });
  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.id, 20);
  assert.equal(data.result.tools.length, 6);
  const names = data.result.tools.map((t) => t.name);
  assert.deepEqual(names, [
    "chira_note_add",
    "chira_inbox_list",
    "chira_count",
    "chira_wiki_list_raw",
    "chira_wiki_read",
    "chira_wiki_search"
  ]);
});

test("MCP: chira_note_add, chira_inbox_list, chira_count (Writing tools)", async () => {
  const kv = createMockKV();
  const env = { INBOX: kv };

  // 1. Call chira_note_add
  const addReq = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "chira_note_add",
        arguments: { content: "First line memo\nSecond line" }
      }
    })
  });
  const addRes = await worker.fetch(addReq, env, {});
  assert.equal(addRes.status, 200);
  const addData = await addRes.json();
  assert.equal(addData.id, 30);
  assert.equal(addData.result.isError, false);
  const addText = JSON.parse(addData.result.content[0].text);
  assert.equal(addText.ok, true);
  assert.equal(addText.closed, false);
  assert.match(addText.name, /^\d{8}_\d{6}\.txt$/);

  // Verify stored in KV
  assert.equal(kv._store.size, 1);
  const stored = JSON.parse(kv._store.get(addText.name));
  assert.equal(stored.content, "First line memo\nSecond line");
  assert.equal(stored.closed, false);

  // 2. Call chira_inbox_list
  const listReq = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "chira_inbox_list",
        arguments: {}
      }
    })
  });
  const listRes = await worker.fetch(listReq, env, {});
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  const listResult = JSON.parse(listData.result.content[0].text);
  assert.equal(listResult.count, 1);
  assert.equal(listResult.items[0].name, addText.name);
  assert.equal(listResult.items[0].title, "First line memo");

  // 3. Call chira_count
  const countReq = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "chira_count",
        arguments: {}
      }
    })
  });
  const countRes = await worker.fetch(countReq, env, {});
  assert.equal(countRes.status, 200);
  const countData = await countRes.json();
  const countResult = JSON.parse(countData.result.content[0].text);
  assert.equal(countResult.count, 1);
  assert.ok(countResult.lastReceived);
});

test("MCP: chira_wiki_list_raw, chira_wiki_read, chira_wiki_search (Reading tools)", async () => {
  const kv = createMockKV();
  const env = {
    INBOX: kv,
    GITHUB_TOKEN: "mock-gh-token",
    GITHUB_REPO_OWNER: "bonsai",
    GITHUB_REPO_NAME: "wiki",
    GITHUB_BRANCH: "master"
  };

  const mockFetch = async (url, options) => {
    // Check GitHub auth header
    assert.equal(options.headers.Authorization, "Bearer mock-gh-token");

    // Git Trees API
    if (url.includes("/git/trees/master")) {
      return new Response(
        JSON.stringify({
          sha: "tree-123",
          tree: [
            { path: "raw/04/20260415_120000.txt", type: "blob", sha: "blob-1" },
            { path: "raw/04/20260416_130000.txt", type: "blob", sha: "blob-2" },
            { path: "raw/05/20260501_100000.txt", type: "blob", sha: "blob-3" },
            { path: "README.md", type: "blob", sha: "blob-4" }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Git Blobs API (for fallback search)
    if (url.includes("/git/blobs/blob-1")) {
      return new Response(
        JSON.stringify({
          content: btoa("TypeScript and Cloudflare Workers memo"),
          encoding: "base64"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/git/blobs/blob-2")) {
      return new Response(
        JSON.stringify({
          content: btoa("Daily standup notes"),
          encoding: "base64"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/git/blobs/blob-3")) {
      return new Response(
        JSON.stringify({
          content: btoa("Nothing interesting here"),
          encoding: "base64"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // GitHub Contents API
    if (url.includes("/contents/raw/04/20260415_120000.txt")) {
      return new Response(
        JSON.stringify({
          name: "20260415_120000.txt",
          path: "raw/04/20260415_120000.txt",
          content: btoa("Sample wiki note text"),
          encoding: "base64"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Search API
    if (url.includes("/search/code")) {
      // Simulate code search failure / fallback test
      return new Response("Search error", { status: 403 });
    }

    return new Response("Not found", { status: 404 });
  };

  // 1. chira_wiki_list_raw with month filter
  const listRawReq = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: {
        name: "chira_wiki_list_raw",
        arguments: { month: "04" }
      }
    })
  });
  const listRawRes = await handleMcpRequest(listRawReq, env, mockFetch);
  const listRawData = await listRawRes.json();
  const listRawContent = JSON.parse(listRawData.result.content[0].text);
  assert.equal(listRawContent.count, 2);
  assert.deepEqual(listRawContent.files, [
    "raw/04/20260415_120000.txt",
    "raw/04/20260416_130000.txt"
  ]);

  // 2. chira_wiki_list_raw without month filter
  const listRawAllReq = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: {
        name: "chira_wiki_list_raw",
        arguments: {}
      }
    })
  });
  const listRawAllRes = await handleMcpRequest(listRawAllReq, env, mockFetch);
  const listRawAllData = await listRawAllRes.json();
  const listRawAllContent = JSON.parse(listRawAllData.result.content[0].text);
  assert.equal(listRawAllContent.count, 3);

  // 3. chira_wiki_read
  const readReq = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: {
        name: "chira_wiki_read",
        arguments: { path: "raw/04/20260415_120000.txt" }
      }
    })
  });
  const readRes = await handleMcpRequest(readReq, env, mockFetch);
  const readData = await readRes.json();
  assert.equal(readData.result.isError, false);
  assert.equal(readData.result.content[0].text, "Sample wiki note text");

  // 4. chira_wiki_search (uses fallback to blob scan when code search returns 403)
  const searchReq = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: {
        name: "chira_wiki_search",
        arguments: { query: "Cloudflare" }
      }
    })
  });
  const searchRes = await handleMcpRequest(searchReq, env, mockFetch);
  const searchData = await searchRes.json();
  assert.equal(searchData.result.isError, false);
  const searchResult = JSON.parse(searchData.result.content[0].text);
  assert.equal(searchResult.total_count, 1);
  assert.equal(searchResult.matches[0].path, "raw/04/20260415_120000.txt");
  assert.match(searchResult.matches[0].snippet, /Cloudflare/);
});
