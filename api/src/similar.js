/**
 * similar.js - related notes by embedding similarity
 *
 * Read-side LLM feature (issue bonsai/chira-ura-cloud#1):
 * GET /similar/<name> -> notes related to the given note ("思い出す").
 *
 * <name> accepts a full wiki path ("raw/04/20260415_120000.txt") or a bare
 * file name ("20260415_120000.txt"). The target and candidates come from the
 * search.js in-memory index; similarity is cosine over embeddings, with a
 * keyword (token overlap) fallback when embeddings are unavailable.
 *
 * Read-only usage: this module never writes to wiki/raw.
 */

import { cosineSimilarity, embedDocsInPlace, getDocs } from "./search.js";
import { embedTexts, hasNvidiaKey, isDegradeableLlmError } from "./llm.js";

const DEFAULT_K = 5;

/**
 * Resolves a bare name or full path to an indexed document.
 * Returns the doc object, or null when not found.
 */
export function resolveTargetDoc(docs, name) {
  const trimmed = (name || "").trim().replace(/^\/+/, "");
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("raw/")) {
    return docs.find((doc) => doc.path === trimmed) || null;
  }
  // Bare file name: match by basename or path suffix.
  return (
    docs.find((doc) => {
      const base = doc.path.split("/").pop();
      return base === trimmed;
    }) ||
    docs.find((doc) => doc.path.endsWith(`/${trimmed}`)) ||
    null
  );
}

/** Keyword (character bigram Jaccard) similarity fallback. Robust for Japanese text. */
function charBigramJaccard(a, b) {
  const bigrams = (text) => {
    const normalized = text.toLowerCase().replace(/\s+/g, "");
    const set = new Set();
    for (let i = 0; i < normalized.length - 1; i++) {
      set.add(normalized.slice(i, i + 2));
    }
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Finds notes related to <name> by embedding similarity.
 * Returns { path, mode, results: [{ path, score }] } or null when the target
 * note is not in the corpus.
 * mode: "embedding" or "keyword" (degraded fallback).
 */
export async function similarNotes({ name, env, fetchFn = fetch, k = DEFAULT_K }) {
  const limit = Math.min(Math.max(parseInt(k, 10) || DEFAULT_K, 1), 20);
  const docs = await getDocs({ env, fetchFn });
  const target = resolveTargetDoc(docs, name);
  if (!target) {
    return null;
  }

  if (hasNvidiaKey(env)) {
    try {
      // Candidates need embeddings too (target may already have one).
      await embedDocsInPlace(docs, { env, fetchFn });
      if (!target.embedding) {
        const [vector] = await embedTexts({
          inputs: target.text,
          env,
          fetchFn,
          inputType: "passage"
        });
        target.embedding = vector || null;
      }
      if (target.embedding) {
        const results = docs
          .filter((doc) => doc !== target && doc.embedding)
          .map((doc) => ({
            path: doc.path,
            score: cosineSimilarity(target.embedding, doc.embedding)
          }))
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
          .slice(0, limit);
        return { path: target.path, mode: "embedding", results };
      }
    } catch (err) {
      if (!isDegradeableLlmError(err)) {
        throw err;
      }
      // embeddings unavailable right now -> keyword fallback below
    }
  }

  const results = docs
    .filter((doc) => doc !== target)
    .map((doc) => ({
      path: doc.path,
      score: charBigramJaccard(target.text, doc.text)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
  return { path: target.path, mode: "keyword", results };
}
