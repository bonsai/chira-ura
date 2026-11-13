import test from "node:test";
import assert from "node:assert/strict";
import {
  LlmError,
  chatCompletion,
  embedTexts,
  consumeRateLimit,
  isDegradeableLlmError,
  rateLimitCount,
  resetRateLimit
} from "../src/llm.js";

test("chatCompletion builds NIM request and parses answer text", async () => {
  resetRateLimit();
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "答えです" } }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const env = { NVIDIA_API_KEY: "nv-key" };
  const answer = await chatCompletion({
    messages: [{ role: "user", content: "こんにちは" }],
    env,
    fetchFn: mockFetch
  });

  assert.equal(answer, "答えです");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer nv-key");

  const body = JSON.parse(calls[0].options.body);
  assert.equal(
    body.model,
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
  );
  // Reasoning model: thinking must be disabled (NIM convention)
  assert.deepEqual(body.chat_template_kwargs, { thinking: false });
  assert.equal(body.messages[0].content, "こんにちは");
});

test("chatCompletion honors LLM_MODEL env override", async () => {
  resetRateLimit();
  let seenModel = null;
  const mockFetch = async (url, options) => {
    seenModel = JSON.parse(options.body).model;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 }
    );
  };

  await chatCompletion({
    messages: [],
    env: { NVIDIA_API_KEY: "k", LLM_MODEL: "other/model" },
    fetchFn: mockFetch
  });
  assert.equal(seenModel, "other/model");
});

test("chatCompletion throws LlmError with status on 429 and it is degradeable", async () => {
  resetRateLimit();
  const mockFetch = async () => new Response("rate limited", { status: 429 });

  await assert.rejects(
    () =>
      chatCompletion({
        messages: [],
        env: { NVIDIA_API_KEY: "k" },
        fetchFn: mockFetch
      }),
    (err) => err instanceof LlmError && err.status === 429
  );

  try {
    await chatCompletion({
      messages: [],
      env: { NVIDIA_API_KEY: "k" },
      fetchFn: mockFetch
    });
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(isDegradeableLlmError(err), true);
  }
});

test("chatCompletion 401 is an error but NOT degradeable", async () => {
  resetRateLimit();
  const mockFetch = async () => new Response("bad key", { status: 401 });
  await assert.rejects(
    () =>
      chatCompletion({
        messages: [],
        env: { NVIDIA_API_KEY: "k" },
        fetchFn: mockFetch
      }),
    (err) => err instanceof LlmError && err.status === 401 && !isDegradeableLlmError(err)
  );
});

test("chatCompletion without NVIDIA_API_KEY throws 401 LlmError", async () => {
  resetRateLimit();
  let called = false;
  const mockFetch = async () => {
    called = true;
  };
  await assert.rejects(
    () => chatCompletion({ messages: [], env: {}, fetchFn: mockFetch }),
    (err) => err instanceof LlmError && err.status === 401
  );
  assert.equal(called, false, "must not touch network without a key");
});

test("embedTexts returns vectors ordered by index (query input type)", async () => {
  resetRateLimit();
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] }
        ]
      }),
      { status: 200 }
    );
  };

  const vectors = await embedTexts({
    inputs: ["一つ目", "二つ目"],
    env: { NVIDIA_API_KEY: "k", LLM_EMBED_MODEL: "nvidia/nemotron-3.5-embed-8b" },
    fetchFn: mockFetch,
    inputType: "query"
  });

  assert.deepEqual(vectors, [[1, 0], [0, 1]]);
  assert.equal(calls[0].url, "https://integrate.api.nvidia.com/v1/embeddings");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "nvidia/nemotron-3.5-embed-8b");
  assert.equal(body.input_type, "query");
  assert.deepEqual(body.input, ["一つ目", "二つ目"]);
});

test("rate limit: requests are counted and exhausted budget raises 429", () => {
  resetRateLimit();
  const env = { LLM_MAX_REQUESTS_PER_HOUR: "2" };

  assert.equal(consumeRateLimit(env), 1);
  assert.equal(consumeRateLimit(env), 2);
  assert.equal(rateLimitCount(), 2);
  assert.throws(() => consumeRateLimit(env), (err) => err instanceof LlmError && err.status === 429);
  resetRateLimit();
  assert.equal(rateLimitCount(), 0);
});
