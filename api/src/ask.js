/**
 * ask.js - RAG question answering over bonsai/wiki raw/ notes
 *
 * Read-side LLM feature (issue bonsai/chira-ura-cloud#1):
 * POST /ask { question } ->
 *   1. retrieve top-k notes via search.js (embedding index, keyword fallback)
 *   2. answer with the LLM, citing sources as raw/<MM>/<name> in the answer text
 *
 * Degradation (never fail hard when the LLM is unavailable):
 * - No NVIDIA_API_KEY / 429 / 5xx / network error -> extractive answer built
 *   from the retrieved snippets with explicit 出典 lines (degraded: true).
 * - If the LLM answer omits citations, a 出典 block is appended so every
 *   response carries sources.
 *
 * Read-only usage: this module never writes to wiki/raw.
 */

import { searchNotes } from "./search.js";
import { chatCompletion, chatModel, hasNvidiaKey, isDegradeableLlmError } from "./llm.js";

const CONTEXT_MAX_CHARS = 800;
const DEFAULT_K = 3;

const SYSTEM_PROMPT = [
  "あなたはチラ裏（bonsai/wiki raw/）の読み返し支援アシスタントです。",
  "与えられたメモ断片だけを根拠に、日本語で簡潔に答えてください。",
  "主張の根拠となったメモには、必ず「出典: raw/<MM>/<name>」の形式で出典を付けてください。",
  "メモ断片から答えられない場合は、その旨を述べ、関連するメモを出典付きで列挙してください。",
  "断片にないことを推測・捏造しないでください。"
].join("\n");

/** Builds the numbered context block from retrieved results. */
function buildContext(results) {
  return results
    .map((row, i) => {
      const text = row.snippet && row.snippet.length > 0
        ? row.snippet
        : "（抜粋なし）";
      return `[${i + 1}] 出典: ${row.path}\n${text.slice(0, CONTEXT_MAX_CHARS)}`;
    })
    .join("\n\n");
}

/** Collects raw/<MM>/<name> citations present in a text. */
function extractCitations(text) {
  const matches = text.match(/raw\/\d{2}\/[^\s、。）)\]]+/g) || [];
  return [...new Set(matches)];
}

/** Extractive (degraded) answer built from snippets alone. */
function extractiveAnswer(results) {
  if (results.length === 0) {
    return "関連するメモが見つかりませんでした。";
  }
  const body = results
    .map((row) => `[抜粋] ${row.snippet || "（抜粋なし）"}\n出典: ${row.path}`)
    .join("\n\n");
  return `（LLMが利用できないため、関連メモの抜粋を返します）\n\n${body}`;
}

/**
 * Ask a question against wiki/raw notes.
 * Returns { answer, sources, mode, degraded, model }.
 * mode: "llm" or "extractive"; degraded: true when the LLM was unavailable.
 */
export async function askNotes({ question, env, fetchFn = fetch, k = DEFAULT_K }) {
  const trimmed = (question || "").trim();
  if (!trimmed) {
    throw new Error("Question is required");
  }

  const search = await searchNotes({ query: trimmed, env, fetchFn, k });
  const results = search.results;
  const citedPaths = results.map((row) => row.path);

  if (!hasNvidiaKey(env)) {
    return {
      answer: extractiveAnswer(results),
      sources: citedPaths,
      mode: "extractive",
      degraded: true,
      model: null
    };
  }

  try {
    const userPrompt = [
      `質問: ${trimmed}`,
      "",
      "メモ断片:",
      buildContext(results)
    ].join("\n");

    const answer = await chatCompletion({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      env,
      fetchFn
    });

    // Guarantee citations: append a 出典 block when the model omitted them.
    const cited = extractCitations(answer);
    let finalAnswer = answer;
    if (cited.length === 0 && citedPaths.length > 0) {
      finalAnswer = `${answer}\n\n出典:\n${citedPaths.map((path) => `- ${path}`).join("\n")}`;
    }

    return {
      answer: finalAnswer,
      sources: cited.length > 0 ? cited : citedPaths,
      mode: "llm",
      degraded: false,
      model: chatModel(env)
    };
  } catch (err) {
    if (!isDegradeableLlmError(err)) {
      throw err;
    }
    return {
      answer: extractiveAnswer(results),
      sources: citedPaths,
      mode: "extractive",
      degraded: true,
      model: null
    };
  }
}
