import test from "node:test";
import assert from "node:assert/strict";
import { formatSessionName, putInbox, getInboxConfig } from "./inbox.js";

test("formatSessionName generates timestamp in YYYYMMDD_HHMMSS.txt format", () => {
  const d = new Date(2026, 10, 5, 14, 30, 45); // Nov is month 10 (0-indexed)
  const name = formatSessionName(d);
  assert.equal(name, "20261105_143045.txt");
  assert.match(name, /^\d{8}_\d{6}\.txt$/);
});

test("formatSessionName handles single digit padding properly", () => {
  const d = new Date(2026, 0, 5, 9, 3, 7); // 2026-01-05 09:03:07
  const name = formatSessionName(d);
  assert.equal(name, "20260105_090307.txt");
});

test("putInbox sends PUT request with full content overwrite and closed flag", async () => {
  let capturedUrl = null;
  let capturedMethod = null;
  let capturedHeaders = null;
  let capturedBody = null;

  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedMethod = opts.method;
    capturedHeaders = opts.headers;
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true })
    };
  };

  const res = await putInbox({
    name: "20261105_120000.txt",
    content: "hello world\nline 2",
    updatedAt: 1700000000000,
    closed: false,
    url: "https://example.workers.dev",
    token: "secret-token-123"
  });

  assert.equal(res.ok, true);
  assert.equal(capturedUrl, "https://example.workers.dev/inbox/20261105_120000.txt");
  assert.equal(capturedMethod, "PUT");
  assert.equal(capturedHeaders["authorization"], "Bearer secret-token-123");
  assert.equal(capturedHeaders["x-chira-token"], "secret-token-123");
  assert.equal(capturedHeaders["content-type"], "application/json");
  assert.deepEqual(capturedBody, {
    content: "hello world\nline 2",
    updatedAt: 1700000000000,
    closed: false
  });
});

test("putInbox sends closed: true properly on close", async () => {
  let capturedBody = null;

  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200 };
  };

  const res = await putInbox({
    name: "20261105_120000.txt",
    content: "closed memo",
    updatedAt: 1700000001000,
    closed: true,
    url: "https://example.workers.dev",
    token: "secret-token-123"
  });

  assert.equal(res.ok, true);
  assert.equal(capturedBody.closed, true);
});

test("putInbox returns error when offline / network error occurs", async () => {
  globalThis.fetch = async () => {
    throw new Error("Failed to fetch");
  };

  const res = await putInbox({
    name: "20261105_120000.txt",
    content: "offline memo",
    updatedAt: 1700000001000,
    closed: false,
    url: "https://example.workers.dev"
  });

  assert.equal(res.ok, false);
  assert.equal(res.error, "Failed to fetch");
});

test("putInbox uses sendBeacon fallback if keepalive is true and fetch fails", async () => {
  let beaconUrl = null;
  let beaconBody = null;

  globalThis.fetch = async () => {
    throw new Error("fetch aborted");
  };

  const originalSendBeacon = globalThis.navigator?.sendBeacon;
  Object.defineProperty(globalThis.navigator, "sendBeacon", {
    value: (url, blob) => {
      beaconUrl = url;
      beaconBody = blob;
      return true;
    },
    configurable: true,
    writable: true
  });

  const res = await putInbox({
    name: "20261105_120000.txt",
    content: "closing page memo",
    updatedAt: 1700000002000,
    closed: true,
    url: "https://example.workers.dev",
    keepalive: true
  });

  assert.equal(res.ok, true);
  assert.equal(res.beacon, true);
  assert.equal(beaconUrl, "https://example.workers.dev/inbox/20261105_120000.txt");

  if (originalSendBeacon) {
    Object.defineProperty(globalThis.navigator, "sendBeacon", {
      value: originalSendBeacon,
      configurable: true,
      writable: true
    });
  } else {
    delete globalThis.navigator.sendBeacon;
  }
});

test("getInboxConfig reads url and token from chrome.storage.local", async () => {
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({
          keys: {
            inbox: {
              url: "https://api.example.com",
              token: "my-token"
            }
          }
        })
      }
    }
  };

  const conf = await getInboxConfig();
  assert.equal(conf.url, "https://api.example.com");
  assert.equal(conf.token, "my-token");

  delete globalThis.chrome;
});
