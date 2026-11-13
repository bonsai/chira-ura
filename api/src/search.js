/**
 * search.js - semantic search over bonsai/wiki raw/ notes
 *
 * Read-side LLM feature (issue bonsai/chira-ura-cloud#1):
 * - Builds an in-memory embedding index over wiki/raw documents
 *   (git tree API -> blob contents, same data access pattern as mcp.js).
 * - GET /search?q= answers from the embedding index (cosine similarity),
 *   never from a raw full-text scan.
 * - Degradation: without NVIDIA_API_KEY, on 429 / 5xx / network errors the
 *   endpoint falls back to a keyword scan and reports mode: "keyword".
 *
 * The index is derived data (cache): document bodies are re-fetched after
 * LLM_INDEX_TTL_SEC (default 300s), capped at LLM_INDEX_MAX_DOCS (default 40)
 * to stay within the Worker free-tier subrequest budget. It never writes
 * back to wiki/raw.
 */

import { embedTexts, hasNvidiaKey, isDegradeableLlmError } from "./llm.js";

const GITHUB_API_BASE = "https://api.github.com";
const REPO_OWNER = "bonsai";
const REPO_NAME = "wiki";
const BRANCH = "master";

const SNIPPET_MAX_LINES = 2;
const SNIPPET_MAX_LINE_CHARS = 160;

/** Decodes a GitHub base64 blob content into utf-8 text. */
function decodeBase64Utf8(base64) {
  const cleanBase64 = base64.replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") {
    return Buffer.from(cleanBase64, "base64").toString("utf-8");
  }
  const binary = atob(cleanBase64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Cosine similarity between two vectors (0 when either is zero-length). */
export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** First (or query-matching) lines of the text, as a short snippet. */
function makeSnippet(text, queryLower = null) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let picked = lines;
  if (queryLower) {
    const matching = lines.filter((line) => line.toLowerCase().includes(queryLower));
    if (matching.length > 0) {
      picked = matching;
    }
  }
  return picked
    .slice(0, SNIPPET_MAX_LINES)
    .map((line) => (line.length > SNIPPET_MAX_LINE_CHARS ? line.slice(0, SNIPPET_MAX_LINE_CHARS) + "…" : line))
    .join("\n");
}

/** Number of case-insensitive occurrences of term in text. */
function countOccurrences(text, term) {
  if (!term) return 0;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text.toLowerCase().match(new RegExp(escaped, "g")) || []).length;
}

/** Keyword-scored fallback search (degraded mode). */
function keywordSearch(docs, query, k) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return docs
    .map((doc) => {
      const haystack = `${doc.path}\n${doc.text}`;
      let occurrences = 0;
      for (const term of terms) {
        occurrences += countOccurrences(haystack, term);
      }
      // Path matches weigh double (a filename hit is a strong signal).
      const pathHits = terms.reduce((sum, term) => sum + countOccurrences(doc.path, term), 0);
      return {
        path: doc.path,
        score: occurrences + pathHits * 2,
        snippet: makeSnippet(doc.text, query.toLowerCase())
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, k);
}

// ---------------------------------------------------------------------------
// Corpus (in-memory derived data; wiki/raw is read, never written)
// ---------------------------------------------------------------------------

let docCache = null; // { docs: [{path, text, embedding?}], builtAt }

export function invalidateIndexCache() {
  docCache = null;
}

function cacheTtlMs(env) {
  return parseInt(env?.LLM_INDEX_TTL_SEC || "300", 10) * 1000;
}

function maxDocs(env) {
  return parseInt(env?.LLM_INDEX_MAX_DOCS || "40", 10);
}

function embedBatchSize(env) {
  return parseInt(env?.LLM_EMBED_BATCH || "8", 10);
}

/**
 * Fetches raw/ documents from bonsai/wiki (tree API -> blob contents).
 * Returns [{ path, text }] sorted by path, capped at LLM_INDEX_MAX_DOCS.
 */
export async function fetchRawDocs({ env, fetchFn = fetch }) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN not configured");
  }
  const owner = env.GITHUB_REPO_OWNER || REPO_OWNER;
  const repo = env.GITHUB_REPO_NAME || REPO_NAME;
  const branch = env.GITHUB_BRANCH || BRANCH;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "chira-ura-worker"
  };

  const treeUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const treeRes = await fetchFn(treeUrl, { headers });
  if (!treeRes.ok) {
    const errText = await treeRes.text();
    throw new Error(`GitHub API error (${treeRes.status}): ${errText}`);
  }
  const treeData = await treeRes.json();
  const blobs = (treeData.tree || [])
    .filter((item) => item.type === "blob" && item.path.startsWith("raw/"))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, maxDocs(env));

  const docs = [];
  for (const blob of blobs) {
    const blobRes = await fetchFn(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs/${blob.sha}`, { headers });
    if (!blobRes.ok) {
      continue;
    }
    const blobData = await blobRes.json();
    if (blobData.encoding === "base64" && typeof blobData.content === "string") {
      docs.push({ path: blob.path, text: decodeBase64Utf8(blobData.content) });
    }
  }
  return docs;
}

/** TTL-cached document corpus; re-fetched after LLM_INDEX_TTL_SEC. */
export async function getDocs({ env, fetchFn = fetch }) {
  if (docCache && Date.now() - docCache.builtAt < cacheTtlMs(env)) {
    return docCache.docs;
  }
  const docs = await fetchRawDocs({ env, fetchFn });
  docCache = { docs, builtAt: Date.now() };
  return docs;
}

/**
 * Adds embeddings (passage vectors) to corpus docs that lack one.
 * Mutates the cached doc objects in place. Throws LlmError on failure.
 */
export async function embedDocsInPlace(docs, { env, fetchFn }) {
  const missing = docs.filter((doc) => !doc.embedding);
  const batchSize = embedBatchSize(env);
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    const vectors = await embedTexts({
      inputs: batch.map((doc) => doc.text),
      env,
      fetchFn,
      inputType: "passage"
    });
    batch.forEach((doc, j) => {
      doc.embedding = vectors[j] || null;
    });
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Semantic search over wiki/raw.
 * Returns { mode, results: [{ path, score, snippet }] }.
 * mode: "embedding" (index-backed) or "keyword" (degraded fallback).
 */
export async function searchNotes({ query, env, fetchFn = fetch, k = 5 }) {
  const trimmed = (query || "").trim();
  if (!trimmed) {
    throw new Error("Query is required");
  }
  const limit = Math.min(Math.max(parseInt(k, 10) || 5, 1), 20);
  const docs = await getDocs({ env, fetchFn });

  if (hasNvidiaKey(env)) {
    try {
      await embedDocsInPlace(docs, { env, fetchFn });
      const [queryVector] = await embedTexts({
        inputs: trimmed,
        env,
        fetchFn,
        inputType: "query"
      });
      const results = docs
        .filter((doc) => doc.embedding)
        .map((doc) => ({
          path: doc.path,
          score: cosineSimilarity(queryVector, doc.embedding),
          snippet: makeSnippet(doc.text, trimmed.toLowerCase())
        }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, limit);
      return { mode: "embedding", results };
    } catch (err) {
      if (!isDegradeableLlmError(err)) {
        throw err;
      }
      // embeddings unavailable right now -> keyword degradation below
    }
  }

  return { mode: "keyword", results: keywordSearch(docs, trimmed, limit) };
}
