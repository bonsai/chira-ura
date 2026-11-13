/**
 * mock-wiki.js - shared mock corpus + fetch/KV mocks for LLM tests.
 * Not a test file (node --test runs only *.test.js); imported by tests.
 * No real network: every fetch is served from in-memory fixtures.
 */

import { invalidateIndexCache } from "../src/search.js";

export const CORPUS = [
  {
    path: "raw/04/20260415_120000.txt",
    text: "TypeScriptとCloudflare Workersのメモ。KVに書き込む話。",
    embedding: [1, 0, 0],
    sha: "blob-1"
  },
  {
    path: "raw/04/20260416_130000.txt",
    text: "マンホールを見つけたので写真を撮った。蓋の模様の話。",
    embedding: [0, 1, 0],
    sha: "blob-2"
  },
  {
    path: "raw/05/20260501_100000.txt",
    text: "Cloudflare Workersでcronを回すメモ。Cloudflare KVの話。",
    embedding: [0.5, 0.5, 0],
    sha: "blob-3"
  }
];

export const QUERY_VECTOR = [1, 0, 0];

export const DEFAULT_CHAT_ANSWER =
  "Cloudflare WorkersとKVに関するメモがあります。\n出典: raw/04/20260415_120000.txt";

/**
 * Builds { env, fetchFn, calls, githubWrites, kv, kvStore, chatRequests, embedRequests }.
 * - fetchFn serves GitHub tree/blob reads and NIM embeddings/chat from fixtures.
 * - Any non-GET request to api.github.com is recorded in githubWrites (and rejected).
 * - chatStatus: force an HTTP status for NIM chat completions.
 * - chatAnswer: fixed answer text for NIM chat completions.
 */
export function createWikiMock({ chatAnswer = DEFAULT_CHAT_ANSWER, chatStatus = 200 } = {}) {
  invalidateIndexCache();

  const calls = []; // { url, method }
  const githubWrites = []; // non-GET api.github.com requests (must stay empty)
  const chatRequests = []; // parsed NIM chat request bodies
  const embedRequests = []; // parsed NIM embeddings request bodies

  const kvStore = new Map([
    [
      "20261105_100000.txt",
      JSON.stringify({ content: "inbox draft memo", updatedAt: 1730800000000, closed: true })
    ]
  ]);
  const kv = {
    async get(key) {
      return kvStore.get(key) || null;
    },
    async put(key, val) {
      kvStore.set(key, val);
    },
    async delete(key) {
      kvStore.delete(key);
    },
    async list() {
      return { keys: Array.from(kvStore.keys()).map((name) => ({ name })), list_complete: true };
    },
    _store: kvStore
  };

  const embedVector = (text) => {
    const hit = CORPUS.find((doc) => doc.text === text);
    if (hit) return hit.embedding;
    if (text.toLowerCase().includes("cloudflare")) return QUERY_VECTOR;
    return [0, 0, 0];
  };

  const fetchFn = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ url, method });

    if (url.startsWith("https://api.github.com")) {
      if (method !== "GET") {
        githubWrites.push({ url, method });
        throw new Error(`GitHub write attempted in test: ${method} ${url}`);
      }
      if (url.includes("/git/trees/master")) {
        return new Response(
          JSON.stringify({
            sha: "tree-123",
            tree: [
              ...CORPUS.map((doc) => ({ path: doc.path, type: "blob", sha: doc.sha })),
              { path: "README.md", type: "blob", sha: "blob-9" }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      const blob = CORPUS.find((doc) => url.endsWith(`/git/blobs/${doc.sha}`));
      if (blob) {
        return new Response(
          JSON.stringify({
            sha: blob.sha,
            content: Buffer.from(blob.text, "utf-8").toString("base64"),
            encoding: "base64"
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    }

    if (url.startsWith("https://integrate.api.nvidia.com/v1/embeddings")) {
      const body = JSON.parse(options.body);
      embedRequests.push(body);
      return new Response(
        JSON.stringify({
          data: body.input.map((text, index) => ({ index, embedding: embedVector(text) }))
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (url.startsWith("https://integrate.api.nvidia.com/v1/chat/completions")) {
      const body = JSON.parse(options.body);
      chatRequests.push(body);
      if (chatStatus !== 200) {
        return new Response("NIM error", { status: chatStatus });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: chatAnswer } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unexpected url in test: ${method} ${url}`);
  };

  const env = {
    INBOX: kv,
    GITHUB_TOKEN: "mock-gh-token",
    NVIDIA_API_KEY: "mock-nv-key",
    GITHUB_REPO_OWNER: "bonsai",
    GITHUB_REPO_NAME: "wiki",
    GITHUB_BRANCH: "master",
    LLM_INDEX_TTL_SEC: "0"
  };

  return { env, fetchFn, calls, githubWrites, kv, kvStore, chatRequests, embedRequests };
}

/** Authorization headers for worker.fetch calls in tests. */
export const AUTH_HEADERS = {
  Authorization: "Bearer mock-gh-token",
  "Content-Type": "application/json"
};
