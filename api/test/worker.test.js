import test from "node:test";
import assert from "node:assert/strict";
import worker, { deriveTitle, authenticate } from "../src/index.js";

// Mock KV namespace implementation for testing
class MockKV {
  constructor() {
    this.store = new Map();
  }

  async put(key, value, options = {}) {
    this.store.set(key, {
      value,
      metadata: options.metadata || null
    });
  }

  async get(key) {
    const item = this.store.get(key);
    return item ? item.value : null;
  }

  async list() {
    const keys = [];
    for (const [key, item] of this.store.entries()) {
      keys.push({
        name: key,
        metadata: item.metadata
      });
    }
    return { keys };
  }
}

test("deriveTitle extracts first non-empty line up to 30 chars", () => {
  assert.equal(deriveTitle(""), "無題");
  assert.equal(deriveTitle("\n\n  Hello World  \nSecond line"), "Hello World");
  assert.equal(
    deriveTitle("123456789012345678901234567890EXTRA"),
    "123456789012345678901234567890"
  );
});

test("authenticate validates Bearer and X-Chira-Token headers", () => {
  const env = { CHIRA_TOKEN: "secret123" };

  // Bearer
  const req1 = new Request("https://example.com/inbox", {
    headers: { Authorization: "Bearer secret123" }
  });
  assert.equal(authenticate(req1, env), true);

  // X-Chira-Token
  const req2 = new Request("https://example.com/inbox", {
    headers: { "X-Chira-Token": "secret123" }
  });
  assert.equal(authenticate(req2, env), true);

  // Invalid token
  const req3 = new Request("https://example.com/inbox", {
    headers: { Authorization: "Bearer wrong" }
  });
  assert.equal(authenticate(req3, env), false);

  // Missing token
  const req4 = new Request("https://example.com/inbox");
  assert.equal(authenticate(req4, env), false);

  // Missing secret in env
  assert.equal(authenticate(req1, {}), false);
});

test("worker returns 401 when token is missing or invalid", async () => {
  const env = { CHIRA_TOKEN: "valid-token", INBOX: new MockKV() };

  const reqNoAuth = new Request("https://example.com/inbox");
  const res1 = await worker.fetch(reqNoAuth, env);
  assert.equal(res1.status, 401);
  const data1 = await res1.json();
  assert.equal(data1.error, "Unauthorized");

  const reqInvalid = new Request("https://example.com/inbox", {
    headers: { Authorization: "Bearer wrong-token" }
  });
  const res2 = await worker.fetch(reqInvalid, env);
  assert.equal(res2.status, 401);
});

test("worker PUT /inbox/:name saves note to KV and GET /inbox lists it", async () => {
  const kv = new MockKV();
  const env = { CHIRA_TOKEN: "valid-token", INBOX: kv };
  const authHeaders = {
    Authorization: "Bearer valid-token",
    "Content-Type": "application/json"
  };

  // Initial GET /count is 0
  const countRes0 = await worker.fetch(
    new Request("https://example.com/count", { headers: authHeaders }),
    env
  );
  assert.equal(countRes0.status, 200);
  assert.deepEqual(await countRes0.json(), { count: 0, lastReceivedAt: null });

  // PUT first note
  const now = 1730000000000;
  const putRes1 = await worker.fetch(
    new Request("https://example.com/inbox/20261105_120000.txt", {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        content: "First note content\nLine 2",
        updatedAt: now,
        closed: false
      })
    }),
    env
  );
  assert.equal(putRes1.status, 200);
  const putData1 = await putRes1.json();
  assert.equal(putData1.ok, true);
  assert.equal(putData1.name, "20261105_120000.txt");
  assert.equal(putData1.title, "First note content");

  // PUT second note
  const putRes2 = await worker.fetch(
    new Request("https://example.com/inbox/20261105_130000.txt", {
      method: "PUT",
      headers: {
        "X-Chira-Token": "valid-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "Second note",
        updatedAt: now + 1000,
        closed: true
      })
    }),
    env
  );
  assert.equal(putRes2.status, 200);

  // GET /inbox returns list sorted by updatedAt descending
  const listRes = await worker.fetch(
    new Request("https://example.com/inbox", { headers: authHeaders }),
    env
  );
  assert.equal(listRes.status, 200);
  const inboxData = await listRes.json();
  assert.equal(inboxData.count, 2);
  assert.equal(inboxData.items.length, 2);
  assert.equal(inboxData.items[0].name, "20261105_130000.txt");
  assert.equal(inboxData.items[0].title, "Second note");
  assert.equal(inboxData.items[0].closed, true);
  assert.equal(inboxData.items[1].name, "20261105_120000.txt");
  assert.equal(inboxData.items[1].title, "First note content");
  assert.equal(inboxData.items[1].closed, false);

  // GET /count returns 2 and lastReceivedAt
  const countRes = await worker.fetch(
    new Request("https://example.com/count", { headers: authHeaders }),
    env
  );
  assert.equal(countRes.status, 200);
  const countData = await countRes.json();
  assert.equal(countData.count, 2);
  assert.equal(countData.lastReceivedAt, new Date(now + 1000).toISOString());

  // Overwrite existing note
  const putRes3 = await worker.fetch(
    new Request("https://example.com/inbox/20261105_120000.txt", {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        content: "Overwritten title\nNew line",
        updatedAt: now + 2000,
        closed: true
      })
    }),
    env
  );
  assert.equal(putRes3.status, 200);

  const listRes2 = await worker.fetch(
    new Request("https://example.com/inbox", { headers: authHeaders }),
    env
  );
  const list2 = await listRes2.json();
  assert.equal(list2.count, 2);
  assert.equal(list2.items.length, 2);
  assert.equal(list2.items[0].name, "20261105_120000.txt");
  assert.equal(list2.items[0].title, "Overwritten title");
  assert.equal(list2.items[0].closed, true);
});
