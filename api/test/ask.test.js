import test from "node:test";
import assert from "node:assert/strict";
import { askNotes } from "../src/ask.js";
import { CORPUS, DEFAULT_CHAT_ANSWER, createWikiMock } from "./mock-wiki.js";

test("askNotes: LLM answer with 出典 citation in raw/<MM>/<name> format", async () => {
  const mock = createWikiMock();
  const result = await askNotes({
    question: "Cloudflareに関するメモは？",
    env: mock.env,
    fetchFn: mock.fetchFn
  });

  assert.equal(result.mode, "llm");
  assert.equal(result.degraded, false);
  assert.ok(result.answer.includes("出典: raw/04/20260415_120000.txt"), "answer must cite raw/<MM>/<name>");
  assert.match(result.answer, /raw\/\d{2}\/[^\s]+\.txt/);
  assert.deepEqual(result.sources, ["raw/04/20260415_120000.txt"]);
  assert.equal(
    result.model,
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
  );

  // Prompt contains the question and retrieved context with citations
  assert.equal(mock.chatRequests.length, 1);
  const messages = mock.chatRequests[0].messages;
  assert.equal(messages[0].role, "system");
  assert.ok(messages[0].content.includes("出典: raw/<MM>/<name>"));
  assert.equal(messages[1].role, "user");
  assert.ok(messages[1].content.includes("質問: Cloudflareに関するメモは？"));
  assert.ok(messages[1].content.includes(`[1] 出典: ${CORPUS[0].path}`));
});

test("askNotes: appends 出典 block when the model omits citations", async () => {
  const mock = createWikiMock({ chatAnswer: "関連するメモがあります。" });
  const result = await askNotes({
    question: "Cloudflare",
    env: mock.env,
    fetchFn: mock.fetchFn
  });

  assert.equal(result.mode, "llm");
  assert.ok(result.answer.includes("出典:"), "citation block must be appended");
  assert.ok(result.answer.includes(CORPUS[0].path));
  assert.ok(result.sources.includes(CORPUS[0].path));
  assert.ok(result.sources.includes(CORPUS[2].path));
});

test("askNotes: degrades to extractive answer when LLM returns 429", async () => {
  const mock = createWikiMock({ chatStatus: 429 });
  const result = await askNotes({
    question: "Cloudflare",
    env: mock.env,
    fetchFn: mock.fetchFn
  });

  assert.equal(result.mode, "extractive");
  assert.equal(result.degraded, true);
  assert.equal(result.model, null);
  // Extractive answer still carries 出典 lines
  assert.ok(result.answer.includes("出典:"));
  assert.ok(result.answer.includes(CORPUS[0].path));
  assert.deepEqual(result.sources, [CORPUS[0].path, CORPUS[2].path]);
});

test("askNotes: degrades to extractive answer without NVIDIA_API_KEY", async () => {
  const mock = createWikiMock();
  delete mock.env.NVIDIA_API_KEY;

  const result = await askNotes({
    question: "Cloudflare",
    env: mock.env,
    fetchFn: mock.fetchFn
  });

  assert.equal(result.mode, "extractive");
  assert.equal(result.degraded, true);
  assert.equal(mock.chatRequests.length, 0, "must not call the LLM without a key");
  assert.ok(result.answer.includes("出典:"));
});

test("askNotes: rejects empty question", async () => {
  const mock = createWikiMock();
  await assert.rejects(() =>
    askNotes({ question: "  ", env: mock.env, fetchFn: mock.fetchFn })
  );
});

test("askNotes: default answer fixture cites correctly", () => {
  assert.match(DEFAULT_CHAT_ANSWER, /出典: raw\/\d{2}\/.+/);
});
