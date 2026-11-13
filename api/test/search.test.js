import test from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, invalidateIndexCache, searchNotes } from "../src/search.js";
import { CORPUS, createWikiMock } from "./mock-wiki.js";

test("cosineSimilarity: identical, orthogonal, opposite and zero vectors", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-12);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-12);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-12);
  assert.ok(Math.abs(cosineSimilarity([0, 0], [1, 0])) < 1e-12);
});

test("searchNotes: embedding mode ranks by cosine and returns snippets", async () => {
  const mock = createWikiMock();
  const { mode, results } = await searchNotes({
    query: "Cloudflare",
    env: mock.env,
    fetchFn: mock.fetchFn,
    k: 2
  });

  assert.equal(mode, "embedding");
  assert.equal(results.length, 2);
  // raw/05 doc: cos([1,0,0],[0.5,0.5,0]) ~= 0.7071; raw/04 doc: 1.0
  assert.equal(results[0].path, CORPUS[0].path);
  assert.ok(Math.abs(results[0].score - 1) < 1e-9);
  assert.equal(results[1].path, CORPUS[2].path);
  assert.ok(Math.abs(results[1].score - Math.SQRT1_2) < 1e-9);
  // snippets carry query-matching lines
  assert.ok(results[0].snippet.includes("Cloudflare"));
  // scores are descending
  assert.ok(results[0].score >= results[1].score);
});

test("searchNotes: embedding mode drops zero-score docs (raw/05 top for its own terms)", async () => {
  const mock = createWikiMock();
  // query embedding resolves to [0,1,0]-ish via fixture text match
  const { mode, results } = await searchNotes({
    query: "マンホール",
    env: mock.env,
    fetchFn: mock.fetchFn
  });
  assert.equal(mode, "embedding");
  // "マンホール" is not a fixture key -> [0,0,0] -> zero scores filtered out
  assert.equal(results.length, 0);
});

test("searchNotes: keyword fallback when NVIDIA_API_KEY is missing", async () => {
  const mock = createWikiMock();
  delete mock.env.NVIDIA_API_KEY;

  const { mode, results } = await searchNotes({
    query: "Cloudflare",
    env: mock.env,
    fetchFn: mock.fetchFn,
    k: 5
  });

  assert.equal(mode, "keyword");
  assert.equal(results.length, 2);
  // raw/05 mentions "Cloudflare" twice -> ranked first
  assert.equal(results[0].path, CORPUS[2].path);
  assert.equal(results[0].score, 2);
  assert.equal(results[1].path, CORPUS[0].path);
  assert.equal(results[1].score, 1);
  assert.ok(results[0].snippet.length > 0);
});

test("searchNotes: 429 from embeddings degrades to keyword mode", async () => {
  const mock = createWikiMock({ chatStatus: 429 });
  // Force embeddings endpoint to 429 as well
  const embedFail = async (url, options = {}) => {
    if (url.startsWith("https://integrate.api.nvidia.com/v1/embeddings")) {
      mock.calls.push({ url, method: options.method || "GET" });
      return new Response("rate limited", { status: 429 });
    }
    return mock.fetchFn(url, options);
  };

  const { mode, results } = await searchNotes({
    query: "Cloudflare",
    env: mock.env,
    fetchFn: embedFail
  });

  assert.equal(mode, "keyword");
  assert.equal(results[0].path, CORPUS[2].path);
});

test("searchNotes: document corpus is cached across calls within TTL", async () => {
  const mock = createWikiMock();
  mock.env.LLM_INDEX_TTL_SEC = "600";
  invalidateIndexCache();

  const githubReads = (arr) => arr.filter((c) => c.url.startsWith("https://api.github.com")).length;

  await searchNotes({ query: "Cloudflare", env: mock.env, fetchFn: mock.fetchFn });
  const readsAfterFirst = githubReads(mock.calls);

  await searchNotes({ query: "Cloudflare", env: mock.env, fetchFn: mock.fetchFn });
  assert.equal(githubReads(mock.calls), readsAfterFirst, "corpus must be cached within TTL");

  invalidateIndexCache();
});

test("searchNotes: rejects empty query", async () => {
  const mock = createWikiMock();
  await assert.rejects(() =>
    searchNotes({ query: "  ", env: mock.env, fetchFn: mock.fetchFn })
  );
});
