import test from "node:test";
import assert from "node:assert/strict";
import { resolveTargetDoc, similarNotes } from "../src/similar.js";
import { CORPUS, createWikiMock } from "./mock-wiki.js";

test("resolveTargetDoc: full path, bare name and path suffix", () => {
  const docs = CORPUS.map((doc) => ({ path: doc.path, text: doc.text }));
  assert.equal(
    resolveTargetDoc(docs, "raw/04/20260415_120000.txt").path,
    CORPUS[0].path
  );
  assert.equal(
    resolveTargetDoc(docs, "20260415_120000.txt").path,
    CORPUS[0].path
  );
  assert.equal(resolveTargetDoc(docs, "存在しない.txt"), null);
  assert.equal(resolveTargetDoc(docs, ""), null);
});

test("similarNotes: embedding mode ranks related docs and excludes self", async () => {
  const mock = createWikiMock();
  const result = await similarNotes({
    name: "20260415_120000.txt",
    env: mock.env,
    fetchFn: mock.fetchFn
  });

  assert.equal(result.path, CORPUS[0].path);
  assert.equal(result.mode, "embedding");
  assert.ok(result.results.length >= 1);
  assert.ok(!result.results.some((row) => row.path === CORPUS[0].path), "self must be excluded");
  assert.equal(result.results[0].path, CORPUS[2].path);
  assert.ok(Math.abs(result.results[0].score - Math.SQRT1_2) < 1e-9);
  // raw/04 doc2 is orthogonal -> zero score -> filtered
  assert.ok(!result.results.some((row) => row.path === CORPUS[1].path));
});

test("similarNotes: accepts full raw/<MM>/<name> path", async () => {
  const mock = createWikiMock();
  const result = await similarNotes({
    name: CORPUS[2].path,
    env: mock.env,
    fetchFn: mock.fetchFn
  });

  assert.equal(result.path, CORPUS[2].path);
  assert.equal(result.results[0].path, CORPUS[0].path);
});

test("similarNotes: keyword fallback without NVIDIA_API_KEY", async () => {
  const mock = createWikiMock();
  delete mock.env.NVIDIA_API_KEY;

  const result = await similarNotes({
    name: CORPUS[0].path,
    env: mock.env,
    fetchFn: mock.fetchFn
  });

  assert.equal(result.mode, "keyword");
  assert.equal(result.path, CORPUS[0].path);
  assert.ok(!result.results.some((row) => row.path === CORPUS[0].path));
  // doc3 shares the most content with doc1 (Cloudflare / Workers / KV)
  assert.equal(result.results[0].path, CORPUS[2].path);
  assert.ok(result.results[0].score > 0);
});

test("similarNotes: returns null for unknown note (routes to 404)", async () => {
  const mock = createWikiMock();
  const result = await similarNotes({
    name: "存在しない_20260101_000000.txt",
    env: mock.env,
    fetchFn: mock.fetchFn
  });
  assert.equal(result, null);
});

test("similarNotes: 429 on embeddings degrades to keyword mode", async () => {
  const mock = createWikiMock({ chatStatus: 429 });
  const embedFail = async (url, options = {}) => {
    if (url.startsWith("https://integrate.api.nvidia.com/v1/embeddings")) {
      mock.calls.push({ url, method: options.method || "GET" });
      return new Response("rate limited", { status: 429 });
    }
    return mock.fetchFn(url, options);
  };

  const result = await similarNotes({
    name: CORPUS[0].path,
    env: mock.env,
    fetchFn: embedFail
  });

  assert.equal(result.mode, "keyword");
  assert.equal(result.results[0].path, CORPUS[2].path);
});
