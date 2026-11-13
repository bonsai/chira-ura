/**
 * llm.js - NVIDIA NIM (OpenAI-compatible) chat + embeddings client
 *
 * Zero-dependency (plain fetch) client for the read-side LLM features
 * (search / ask / similar, see issue bonsai/chira-ura-cloud#1).
 * Read-only usage: this module never writes to wiki/raw.
 *
 * Env:
 * - NVIDIA_API_KEY: NIM API key (set via `wrangler secret put NVIDIA_API_KEY`).
 *   When missing, callers degrade to keyword / extractive responses.
 * - LLM_MODEL: chat model (default nvidia/nemotron-3-nano-omni-30b-a3b-reasoning)
 * - LLM_EMBED_MODEL: embedding model (default nvidia/nemotron-3.5-embed-8b)
 * - LLM_MAX_REQUESTS_PER_HOUR: in-memory request budget (default 100).
 *   Exceeding it raises LlmError(429) so callers can fall back gracefully.
 *
 * All requests go through an injectable fetchFn (last argument) so tests
 * never touch the real network.
 */

const NIM_BASE = "https://integrate.api.nvidia.com/v1";

export const DEFAULT_CHAT_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
export const DEFAULT_EMBED_MODEL = "nvidia/nemotron-3.5-embed-8b";

/** Error carrying an HTTP status so callers can decide to degrade (e.g. 429). */
export class LlmError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

/**
 * True when the error is transient / quota related and a degraded response
 * is preferable to failing the request (429, 5xx, network failure).
 * 401/403 (misconfiguration) are NOT degradable: they should be visible.
 */
export function isDegradeableLlmError(err) {
  if (!(err instanceof LlmError)) {
    return false;
  }
  return err.status === 429 || err.status >= 500;
}

export function hasNvidiaKey(env) {
  return Boolean(env && env.NVIDIA_API_KEY);
}

export function chatModel(env) {
  return env?.LLM_MODEL || DEFAULT_CHAT_MODEL;
}

export function embedModel(env) {
  return env?.LLM_EMBED_MODEL || DEFAULT_EMBED_MODEL;
}

/**
 * In-memory hourly request budget (per Worker isolate; a soft guard for the
 * free tier). Counted requests: every chat completion and embeddings call.
 * Throws LlmError(429) when the budget is exhausted.
 */
const rateWindows = new Map();

export function resetRateLimit() {
  rateWindows.clear();
}

export function rateLimitCount() {
  const hour = Math.floor(Date.now() / 3600000);
  return rateWindows.get(hour) || 0;
}

export function consumeRateLimit(env) {
  const max = parseInt(env?.LLM_MAX_REQUESTS_PER_HOUR || "100", 10);
  const hour = Math.floor(Date.now() / 3600000);
  for (const key of rateWindows.keys()) {
    if (key !== hour) rateWindows.delete(key);
  }
  const count = (rateWindows.get(hour) || 0) + 1;
  rateWindows.set(hour, count);
  if (count > max) {
    throw new LlmError("LLM rate limit exceeded for this hour (free tier guard)", 429);
  }
  return count;
}

/**
 * Chat completion against NIM /chat/completions.
 * Returns the assistant message text (choices[0].message.content).
 *
 * The default chat model is a reasoning model, so thinking is disabled via
 * chat_template_kwargs (NIM convention) to keep answers prompt-only.
 */
export async function chatCompletion({
  messages,
  env,
  fetchFn = fetch,
  maxTokens = 512,
  temperature = 0.2,
  thinking = false
}) {
  if (!hasNvidiaKey(env)) {
    throw new LlmError("NVIDIA_API_KEY not configured", 401);
  }
  consumeRateLimit(env);

  const res = await fetchFn(`${NIM_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: chatModel(env),
      messages,
      max_tokens: maxTokens,
      temperature,
      chat_template_kwargs: { thinking }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new LlmError(`NIM chat error (${res.status}): ${errText.slice(0, 300)}`, res.status);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new LlmError("NIM chat response missing choices[0].message.content", 502);
  }
  return content;
}

/**
 * Embeddings against NIM /embeddings.
 * `inputs`: string or array of strings. `inputType`: "query" (search query)
 * or "passage" (documents to index), following the NIM retrieval convention.
 * Returns an array of float vectors in the same order as the inputs.
 */
export async function embedTexts({
  inputs,
  env,
  fetchFn = fetch,
  inputType = "query"
}) {
  if (!hasNvidiaKey(env)) {
    throw new LlmError("NVIDIA_API_KEY not configured", 401);
  }
  const list = Array.isArray(inputs) ? inputs : [inputs];
  if (list.length === 0) {
    return [];
  }
  consumeRateLimit(env);

  const res = await fetchFn(`${NIM_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: embedModel(env),
      input: list,
      input_type: inputType,
      encoding_format: "float"
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new LlmError(`NIM embeddings error (${res.status}): ${errText.slice(0, 300)}`, res.status);
  }

  const data = await res.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows
    .slice()
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((row) => row.embedding);
}
