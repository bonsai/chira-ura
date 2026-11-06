/**
 * cli/wiki-push.js
 *
 * Batch push unsynced notes to GitHub repository (bonsai/wiki)
 * Layout: bonsai/wiki/raw/<MM>/<timestamp>.txt
 * Pushes all pending notes in a single commit using GitHub Git Data API.
 */

import { getUnsyncedWikiNotes, markNoteWikiSynced } from "./ura-db.js";

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_REPO_OWNER = "bonsai";
const DEFAULT_REPO_NAME = "wiki";
const DEFAULT_BRANCH = "master";

/**
 * Format timestamp as YYYYMMDD_HHMMSS.txt
 * Handles Date object, millisecond timestamp, or ISO string.
 */
export function formatTimestampFilename(time) {
  const d = time ? new Date(time) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}.txt`;
}

/**
 * Derives <MM> (two-digit month) from filename or updatedAt.
 */
export function getMonthDir(filename, updatedAt) {
  if (filename) {
    const match = filename.match(/\d{4}(\d{2})\d{2}[-_]\d{6}/);
    if (match) return match[1];
  }
  const date = updatedAt ? new Date(updatedAt) : new Date();
  const m = date.getMonth() + 1;
  return String(m).padStart(2, "0");
}

/**
 * Push an array of notes to GitHub in 1 commit.
 * Each note has { id, title, content, updatedAt }.
 */
export async function pushNotesToWiki({
  notes,
  owner = DEFAULT_REPO_OWNER,
  repo = DEFAULT_REPO_NAME,
  branch = DEFAULT_BRANCH,
  token,
  fetchFn = fetch
}) {
  if (!token) {
    throw new Error("GitHub token is not configured (GITHUB_TOKEN or github.token missing)");
  }
  if (!notes || notes.length === 0) {
    return null;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "chira-ura-cli",
    "Content-Type": "application/json"
  };

  // 1. Get branch ref
  const refUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${branch}`;
  const refRes = await fetchFn(refUrl, { headers });
  if (!refRes.ok) {
    const errText = await refRes.text();
    throw new Error(`Failed to get git ref for ${branch} (${refRes.status}): ${errText}`);
  }
  const refData = await refRes.json();
  const latestCommitSha = refData.object.sha;

  // 2. Get base tree SHA
  const commitUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${latestCommitSha}`;
  const commitRes = await fetchFn(commitUrl, { headers });
  if (!commitRes.ok) {
    const errText = await commitRes.text();
    throw new Error(`Failed to get commit ${latestCommitSha} (${commitRes.status}): ${errText}`);
  }
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  // 3. Build tree items under raw/<MM>/<timestamp>.txt
  // To avoid duplicate filename if multiple notes have exact same second, append suffix if needed
  const usedPaths = new Set();
  const treeItems = notes.map((note) => {
    let filename = formatTimestampFilename(note.updatedAt);
    let mm = getMonthDir(filename, note.updatedAt);
    let path = `raw/${mm}/${filename}`;
    let counter = 1;
    while (usedPaths.has(path)) {
      const base = filename.replace(/\.txt$/, "");
      path = `raw/${mm}/${base}_${counter}.txt`;
      counter++;
    }
    usedPaths.add(path);

    return {
      path,
      mode: "100644",
      type: "blob",
      content: note.content || ""
    };
  });

  // 4. Create new tree
  const treeUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`;
  const treeRes = await fetchFn(treeUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeItems
    })
  });
  if (!treeRes.ok) {
    const errText = await treeRes.text();
    throw new Error(`Failed to create tree (${treeRes.status}): ${errText}`);
  }
  const treeData = await treeRes.json();
  const newTreeSha = treeData.sha;

  // 5. Create new commit
  const newCommitUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`;
  const fileNamesSummary = treeItems.map((item) => item.path.split("/").pop()).join(", ");
  const commitMessage = `chore(wiki): archive ${notes.length} memo(s) [${fileNamesSummary}]`;
  const newCommitRes = await fetchFn(newCommitUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: commitMessage,
      tree: newTreeSha,
      parents: [latestCommitSha]
    })
  });
  if (!newCommitRes.ok) {
    const errText = await newCommitRes.text();
    throw new Error(`Failed to create commit (${newCommitRes.status}): ${errText}`);
  }
  const newCommitData = await newCommitRes.json();
  const newCommitSha = newCommitData.sha;

  // 6. Update branch ref
  const updateRefRes = await fetchFn(refUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      sha: newCommitSha
    })
  });
  if (!updateRefRes.ok) {
    const errText = await updateRefRes.text();
    throw new Error(`Failed to update ref ${branch} (${updateRefRes.status}): ${errText}`);
  }

  return {
    commitSha: newCommitSha,
    count: notes.length
  };
}

/**
 * Synchronize unsynced SQLite notes directly to GitHub bonsai/wiki raw/<MM>/
 * In offline or network failure scenarios, silently returns { ok: false, reason: "..." }
 * and leaves notes unmarked for next retry.
 */
export async function syncWiki(db, options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN || options.keys?.github?.token || options.keys?.gh?.token;
  if (!token) {
    if (options.verbose) console.warn("GITHUB_TOKEN 未設定（オフライン扱い・スキップ）");
    return { ok: false, sent: 0, reason: "no_token" };
  }

  const unsynced = getUnsyncedWikiNotes(db);
  if (!unsynced.length) {
    return { ok: true, sent: 0 };
  }

  const owner = options.owner || process.env.GITHUB_REPO_OWNER || options.keys?.github?.owner || DEFAULT_REPO_OWNER;
  const repo = options.repo || process.env.GITHUB_REPO_NAME || options.keys?.github?.repo || DEFAULT_REPO_NAME;
  const branch = options.branch || process.env.GITHUB_BRANCH || options.keys?.github?.branch || DEFAULT_BRANCH;

  try {
    const result = await pushNotesToWiki({
      notes: unsynced,
      owner,
      repo,
      branch,
      token,
      fetchFn: options.fetchFn || fetch
    });

    if (result && result.commitSha) {
      for (const note of unsynced) {
        markNoteWikiSynced(db, note.id, note.updatedAt);
      }
      return { ok: true, sent: unsynced.length, commitSha: result.commitSha };
    }
    return { ok: true, sent: 0 };
  } catch (err) {
    if (options.verbose) console.warn(`Wiki push 失敗: ${err.message}`);
    return { ok: false, sent: 0, reason: "network_error", error: err.message };
  }
}
