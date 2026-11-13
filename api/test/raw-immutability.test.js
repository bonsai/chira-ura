/**
 * raw-immutability.test.js
 *
 * Guarantees issue #1 acceptance: "raw 以下のファイルが LLM 経路で一切変更されない".
 * Every LLM path (REST + MCP) is exercised against mocks that
 *  - record and REJECT any non-GET request to api.github.com (wiki/raw lives there),
 *  - record every KV mutation.
 * If any LLM path attempted a wiki push / write, the test fails loudly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { handleMcpRequest } from "../src/mcp.js";
import { createWikiMock } from "./mock-wiki.js";

const AUTH = { Authorization: "Bearer mock-gh-token", "Content-Type": "application/json" };

async function runAllLlmPaths({ env, fetchFn }) {
  const outcomes = {};

  // REST: GET /search
  const searchRes = await worker.fetch(
    new Request("https://worker.local/search?q=Cloudflare", { headers: AUTH }),
    env,
    {},
    fetchFn
  );
  assert.equal(searchRes.status, 200);
  outcomes.search = await searchRes.json();

  // REST: POST /ask
  const askRes = await worker.fetch(
    new Request("https://worker.local/ask", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ question: "Cloudflare に関するメモは？" })
    }),
    env,
    {},
    fetchFn
  );
  assert.equal(askRes.status, 200);
  outcomes.ask = await askRes.json();

  // REST: GET /similar/<name>
  const similarRes = await worker.fetch(
    new Request("https://worker.local/similar/20260415_120000.txt", { headers: AUTH }),
    env,
    {},
    fetchFn
  );
  assert.equal(similarRes.status, 200);
  outcomes.similar = await similarRes.json();

  // MCP: search_notes / ask_notes / related_notes
  const mcpCall = (id, name, args) =>
    handleMcpRequest(
      new Request("https://worker.local/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args }
        })
      }),
      env,
      fetchFn
    );

  const mcpSearch = await mcpCall(60, "search_notes", { query: "Cloudflare" });
  assert.equal((await mcpSearch.json()).result.isError, false);
  const mcpAsk = await mcpCall(61, "ask_notes", { question: "Cloudflareに関するメモは？" });
  assert.equal((await mcpAsk.json()).result.isError, false);
  const mcpRelated = await mcpCall(62, "related_notes", { name: "20260415_120000.txt" });
  assert.equal((await mcpRelated.json()).result.isError, false);

  return outcomes;
}

test("raw immutability: LLM paths never write to GitHub (wiki/raw) nor mutate KV", async () => {
  const mock = createWikiMock();
  const kvSnapshot = JSON.stringify(Array.from(mock.kvStore.entries()));

  const outcomes = await runAllLlmPaths(mock);

  // 1. No write requests to GitHub at all (raw/ lives on api.github.com)
  assert.equal(
    mock.githubWrites.length,
    0,
    `LLM paths attempted GitHub writes: ${JSON.stringify(mock.githubWrites)}`
  );

  // 2. Only GET requests reached api.github.com
  const githubCalls = mock.calls.filter((c) => c.url.startsWith("https://api.github.com"));
  assert.ok(githubCalls.length > 0, "LLM paths must read wiki/raw via GitHub");
  for (const call of githubCalls) {
    assert.equal(call.method, "GET", `non-GET GitHub call: ${call.method} ${call.url}`);
  }

  // 3. NIM was used read-only too (POST only, no mutations)
  const nimCalls = mock.calls.filter((c) => c.url.startsWith("https://integrate.api.nvidia.com"));
  assert.ok(nimCalls.length > 0, "LLM paths must exercise the NIM client");
  for (const call of nimCalls) {
    assert.equal(call.method, "POST");
    assert.ok(
      call.url.endsWith("/chat/completions") || call.url.endsWith("/embeddings"),
      `unexpected NIM endpoint: ${call.url}`
    );
  }

  // 4. KV inbox is untouched by LLM paths (no put/delete happened)
  assert.equal(JSON.stringify(Array.from(mock.kvStore.entries())), kvSnapshot);

  // 5. The paths actually served real content (embedding mode, citations)
  assert.equal(outcomes.search.mode, "embedding");
  assert.ok(outcomes.ask.answer.includes("出典: raw/04/20260415_120000.txt"));
  assert.equal(outcomes.similar.mode, "embedding");
});

test("raw immutability: degraded LLM paths (429) also never write", async () => {
  const mock = createWikiMock({ chatStatus: 429 });
  const embedFail = async (url, options = {}) => {
    if (url.startsWith("https://integrate.api.nvidia.com/v1/embeddings")) {
      mock.calls.push({ url, method: options.method || "GET" });
      return new Response("rate limited", { status: 429 });
    }
    return mock.fetchFn(url, options);
  };
  const kvSnapshot = JSON.stringify(Array.from(mock.kvStore.entries()));

  const outcomes = await runAllLlmPaths({ env: mock.env, fetchFn: embedFail });

  assert.equal(mock.githubWrites.length, 0);
  const githubCalls = mock.calls.filter((c) => c.url.startsWith("https://api.github.com"));
  for (const call of githubCalls) {
    assert.equal(call.method, "GET");
  }
  assert.equal(JSON.stringify(Array.from(mock.kvStore.entries())), kvSnapshot);

  // Degraded responses are served (keyword / extractive), never errors
  assert.equal(outcomes.search.mode, "keyword");
  assert.equal(outcomes.ask.mode, "extractive");
  assert.ok(outcomes.ask.answer.includes("出典:"));
  assert.equal(outcomes.similar.mode, "keyword");
});

test("raw immutability: worker route table keeps LLM endpoints read-only (GET/POST bodies only)", async () => {
  // /search and /similar must reject non-GET; /ask must reject non-POST
  const mock = createWikiMock();
  mock.env.API_TOKEN = "t";

  const postSearch = await worker.fetch(
    new Request("https://worker.local/search", { method: "POST", headers: { Authorization: "Bearer t" } }),
    mock.env,
    {},
    mock.fetchFn
  );
  assert.equal(postSearch.status, 404, "POST /search must not exist");

  const putAsk = await worker.fetch(
    new Request("https://worker.local/ask", { method: "PUT", headers: { Authorization: "Bearer t" }, body: "{}" }),
    mock.env,
    {},
    mock.fetchFn
  );
  assert.equal(putAsk.status, 404, "PUT /ask must not exist");

  const delSimilar = await worker.fetch(
    new Request("https://worker.local/similar/20260415_120000.txt", { method: "DELETE", headers: { Authorization: "Bearer t" } }),
    mock.env,
    {},
    mock.fetchFn
  );
  assert.equal(delSimilar.status, 404, "DELETE /similar must not exist");

  assert.equal(mock.githubWrites.length, 0);
});
