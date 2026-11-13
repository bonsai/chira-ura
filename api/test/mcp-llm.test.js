import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS, handleMcpRequest } from "../src/mcp.js";
import { AUTH_HEADERS, CORPUS, createWikiMock } from "./mock-wiki.js";

function mcpRequest(id, name, args) {
  return new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args }
    })
  });
}

test("TOOLS registry exposes the 3 read-side LLM tools as read-only", () => {
  const llmTools = TOOLS.filter((t) => ["search_notes", "ask_notes", "related_notes"].includes(t.name));
  assert.equal(llmTools.length, 3);
  for (const tool of llmTools) {
    assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} must be read-only`);
  }
  assert.equal(TOOLS.find((t) => t.name === "search_notes").inputSchema.required[0], "query");
  assert.equal(TOOLS.find((t) => t.name === "ask_notes").inputSchema.required[0], "question");
  assert.equal(TOOLS.find((t) => t.name === "related_notes").inputSchema.required[0], "name");
});

test("MCP: tools/call search_notes routes to semantic search", async () => {
  const mock = createWikiMock();
  const res = await handleMcpRequest(mcpRequest(50, "search_notes", { query: "Cloudflare", k: 2 }), mock.env, mock.fetchFn);
  const data = await res.json();

  assert.equal(data.result.isError, false);
  const payload = JSON.parse(data.result.content[0].text);
  assert.equal(payload.mode, "embedding");
  assert.equal(payload.results.length, 2);
  assert.equal(payload.results[0].path, CORPUS[0].path);
  assert.ok(payload.results[0].snippet.length > 0);
});

test("MCP: tools/call ask_notes returns answer with sources", async () => {
  const mock = createWikiMock();
  const res = await handleMcpRequest(mcpRequest(51, "ask_notes", { question: "Cloudflareに関するメモは？" }), mock.env, mock.fetchFn);
  const data = await res.json();

  assert.equal(data.result.isError, false);
  const payload = JSON.parse(data.result.content[0].text);
  assert.equal(payload.mode, "llm");
  assert.ok(payload.answer.includes("出典: raw/04/20260415_120000.txt"));
  assert.deepEqual(payload.sources, ["raw/04/20260415_120000.txt"]);
});

test("MCP: tools/call related_notes routes to similar notes", async () => {
  const mock = createWikiMock();
  const res = await handleMcpRequest(mcpRequest(52, "related_notes", { name: "20260415_120000.txt" }), mock.env, mock.fetchFn);
  const data = await res.json();

  assert.equal(data.result.isError, false);
  const payload = JSON.parse(data.result.content[0].text);
  assert.equal(payload.path, CORPUS[0].path);
  assert.equal(payload.results[0].path, CORPUS[2].path);
});

test("MCP: tools/call related_notes unknown name -> isError result", async () => {
  const mock = createWikiMock();
  const res = await handleMcpRequest(mcpRequest(53, "related_notes", { name: "存在しない.txt" }), mock.env, mock.fetchFn);
  const data = await res.json();

  assert.equal(data.result.isError, true);
  assert.ok(data.result.content[0].text.includes("Note not found in corpus"));
});

test("MCP: unknown tool still returns -32602 error", async () => {
  const mock = createWikiMock();
  const res = await handleMcpRequest(mcpRequest(54, "nonexistent_tool", {}), mock.env, mock.fetchFn);
  const data = await res.json();
  assert.equal(data.error.code, -32602);
});

test("MCP: LLM tools work through worker.fetch with X-Chira-Token auth", async () => {
  const mock = createWikiMock();
  mock.env.API_TOKEN = "secret-token-123";

  const req = new Request("https://worker.local/mcp", {
    method: "POST",
    headers: { ...AUTH_HEADERS, Authorization: "Bearer secret-token-123", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 55, method: "tools/call", params: { name: "search_notes", arguments: { query: "Cloudflare" } } })
  });
  const res = await fetchFnAwareWorkerFetch(req, mock.env, mock.fetchFn);
  assert.equal(res.status, 200);
  const data = await res.json();
  const payload = JSON.parse(data.result.content[0].text);
  assert.equal(payload.mode, "embedding");
});

// worker.fetch(request, env, ctx, fetchFn) - 4th arg injected for tests
import worker from "../src/index.js";
const fetchFnAwareWorkerFetch = (req, env, fetchFn) => worker.fetch(req, env, {}, fetchFn);
