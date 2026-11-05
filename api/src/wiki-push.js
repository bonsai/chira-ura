/**
 * wiki-push.js
 *
 * Cloudflare Worker Cron batch logic:
 * - Collects all 'closed' files from KV (INBOX)
 * - Pushes all closed files in 1 single commit to bonsai/wiki (private / master) under raw/<MM>/<filename>
 * - Key names in KV are preserved as filenames
 * - Deletes only successfully pushed items from KV
 * - If push fails, items remain in KV for next hourly retry (idempotent overwrite)
 * - GitHub token is read from env.GITHUB_TOKEN (secret)
 */

const GITHUB_API_BASE = "https://api.github.com";
const REPO_OWNER = "bonsai";
const REPO_NAME = "wiki";
const BRANCH = "master";

/**
 * Derives <MM> (two-digit month) from filename (e.g. YYYYMMDD_HHMMSS.txt or 無題N_YYYYMMDD_HHMMSS.txt)
 * or updatedAt timestamp, or current time.
 */
export function getMonthDir(filename, updatedAt) {
  // Check if filename has YYYYMMDD pattern (e.g. 20261105_123456 or 無題1_20260415_090000)
  const match = filename.match(/\d{4}(\d{2})\d{2}[-_]\d{6}/);
  if (match) {
    return match[1];
  }
  const date = updatedAt ? new Date(updatedAt) : new Date();
  const m = date.getUTCMonth() + 1;
  return String(m).padStart(2, "0");
}

/**
 * Lists all keys from KV namespace (handles pagination if more than 1000).
 */
export async function listAllKeys(kvNamespace) {
  const keys = [];
  let cursor = undefined;
  do {
    const res = await kvNamespace.list({ cursor });
    if (res && res.keys) {
      keys.push(...res.keys);
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return keys;
}

/**
 * Fetches closed files from KV.
 * Returns array of { key, content, updatedAt, closed }
 */
export async function getClosedFiles(kvNamespace) {
  const allKeys = await listAllKeys(kvNamespace);
  const closedFiles = [];

  for (const entry of allKeys) {
    const raw = await kvNamespace.get(entry.name);
    if (!raw) continue;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // In case content is plain string or invalid JSON
      continue;
    }

    if (data && data.closed === true) {
      closedFiles.push({
        key: entry.name,
        content: typeof data.content === "string" ? data.content : "",
        updatedAt: data.updatedAt,
        closed: true
      });
    }
  }

  return closedFiles;
}

/**
 * Pushes multiple files to GitHub repository in a single commit using the Git Data API.
 */
export async function pushFilesToGitHub({
  files,
  owner = REPO_OWNER,
  repo = REPO_NAME,
  branch = BRANCH,
  token,
  fetchFn = fetch
}) {
  if (!token) {
    throw new Error("GitHub token is not configured (GITHUB_TOKEN missing)");
  }
  if (!files || files.length === 0) {
    return null;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "chira-ura-worker",
    "Content-Type": "application/json"
  };

  // 1. Get reference for the branch to find latest commit SHA
  const refUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${branch}`;
  const refRes = await fetchFn(refUrl, { headers });
  if (!refRes.ok) {
    const errText = await refRes.text();
    throw new Error(`Failed to get git ref for ${branch} (${refRes.status}): ${errText}`);
  }
  const refData = await refRes.json();
  const latestCommitSha = refData.object.sha;

  // 2. Get latest commit to find base_tree SHA
  const commitUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${latestCommitSha}`;
  const commitRes = await fetchFn(commitUrl, { headers });
  if (!commitRes.ok) {
    const errText = await commitRes.text();
    throw new Error(`Failed to get commit ${latestCommitSha} (${commitRes.status}): ${errText}`);
  }
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  // 3. Build tree items
  const treeItems = files.map(file => {
    const mm = getMonthDir(file.key, file.updatedAt);
    const path = `raw/${mm}/${file.key}`;
    return {
      path,
      mode: "100644",
      type: "blob",
      content: file.content
    };
  });

  // 4. Create new tree with base_tree
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
  const fileNamesSummary = files.map(f => f.key).join(", ");
  const commitMessage = `chore(wiki): archive ${files.length} closed memo(s) [${fileNamesSummary}]`;
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
    fileCount: files.length
  };
}

/**
 * Main batch handler for hourly cron:
 * - Collects closed files from KV
 * - Pushes to bonsai/wiki raw/<MM>/ in 1 commit
 * - Deletes only pushed files from KV
 * - Returns execution summary
 */
export async function flushClosedFiles({ env, fetchFn = fetch }) {
  const kv = env.INBOX;
  if (!kv) {
    throw new Error("KV namespace INBOX is not bound");
  }

  const closedFiles = await getClosedFiles(kv);
  if (closedFiles.length === 0) {
    return {
      processed: 0,
      deleted: 0,
      message: "No closed files found"
    };
  }

  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_REPO_OWNER || REPO_OWNER;
  const repo = env.GITHUB_REPO_NAME || REPO_NAME;
  const branch = env.GITHUB_BRANCH || BRANCH;

  // Attempt push to GitHub
  // If this throws, execution stops and nothing is deleted from KV
  const pushResult = await pushFilesToGitHub({
    files: closedFiles,
    owner,
    repo,
    branch,
    token,
    fetchFn
  });

  // Once GitHub push succeeds, delete pushed files from KV
  let deletedCount = 0;
  for (const file of closedFiles) {
    try {
      await kv.delete(file.key);
      deletedCount++;
    } catch (err) {
      console.error(`Failed to delete key ${file.key} from KV:`, err);
    }
  }

  return {
    processed: closedFiles.length,
    deleted: deletedCount,
    commitSha: pushResult ? pushResult.commitSha : null
  };
}
