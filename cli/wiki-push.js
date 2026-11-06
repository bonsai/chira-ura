// chira-ura CLI — オフラインのメモを bonsai/wiki raw/<MM>/ へ push する
//
// - クライアント（crx / gui/win / gui/rust）は ~/.chira/ura.db に保存するだけ。
//   送信は CLI が担う（保存と送信を疎結合に）。
// - 未送信メモを 10 件ずつ 1 コミットにまとめて bonsai/wiki の raw/<MM>/<name>.txt へ。
// - 送信済みは meta（sync.wiki）で管理し、冪等（再実行で重複しない）。
// - 失敗バッチは送信済みにせず、次回リトライする。
//
// 手順は API 側 api/src/wiki-push.js と同じ GitHub Git Data API（1 バッチ = 1 コミット）。
// 認証トークンは CHIRA_GH_TOKEN → GITHUB_TOKEN → `gh auth token` の順で解決。

import { execFileSync } from "node:child_process";
import { getMeta, setMeta, listNotes } from "./ura-db.js";

const GITHUB_API_BASE = "https://api.github.com";
export const DEFAULT_OWNER = "bonsai";
export const DEFAULT_REPO = "wiki";
export const DEFAULT_BRANCH = "master";
export const WIKI_BATCH_SIZE = 10;

/**
 * ファイル名（YYYYMMDD_HHMMSS[_xxxx].txt）または updatedAt から <MM> を導出。
 */
export function getMonthDir(filename, updatedAt) {
  const match = String(filename).match(/\d{4}(\d{2})\d{2}[-_]\d{6}/);
  if (match) return match[1];
  const date = updatedAt ? new Date(updatedAt) : new Date();
  return String(date.getUTCMonth() + 1).padStart(2, "0");
}

/**
 * メモのタイムスタンプ名を作る（UTC）。id の末尾 4 文字で同秒の衝突を避ける。
 */
export function formatNoteFileName(updatedAt, id = "") {
  const d = new Date(updatedAt || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const suffix = String(id).replace(/[^a-z0-9]/gi, "").slice(-4) || "0000";
  return `${stamp}_${suffix}.txt`;
}

// ---------- 送信済み管理（meta 側に持ち canonical を壊さない） ----------
export function getWikiSyncMeta(db) {
  const val = getMeta(db, "sync.wiki", {});
  return val && typeof val === "object" ? val : {};
}

export function markWikiSynced(db, id, syncedAt = Date.now()) {
  const cur = getWikiSyncMeta(db);
  cur[id] = syncedAt;
  setMeta(db, "sync.wiki", cur);
}

/** まだ wiki へ送っていないメモ（新しい順） */
export function getUnsyncedWikiNotes(db) {
  const syncMeta = getWikiSyncMeta(db);
  return listNotes(db).filter((n) => n.updatedAt > Number(syncMeta[n.id] || 0));
}

/**
 * 複数ファイルを 1 コミットで GitHub リポジトリへ push（Git Data API）。
 * files: [{ key, content, updatedAt }]
 */
export async function pushFilesToGitHub({
  files,
  owner = DEFAULT_OWNER,
  repo = DEFAULT_REPO,
  branch = DEFAULT_BRANCH,
  token,
  fetchFn = fetch
}) {
  if (!token) throw new Error("GitHub token is not configured");
  if (!files || files.length === 0) return null;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "chira-ura-cli",
    "Content-Type": "application/json"
  };

  // 1. ブランチの最新コミット SHA
  const refUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${branch}`;
  const refRes = await fetchFn(refUrl, { headers });
  if (!refRes.ok) {
    throw new Error(`Failed to get git ref for ${branch} (${refRes.status}): ${await refRes.text()}`);
  }
  const latestCommitSha = (await refRes.json()).object.sha;

  // 2. base_tree
  const commitRes = await fetchFn(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
    { headers }
  );
  if (!commitRes.ok) {
    throw new Error(`Failed to get commit ${latestCommitSha} (${commitRes.status}): ${await commitRes.text()}`);
  }
  const baseTreeSha = (await commitRes.json()).tree.sha;

  // 3. tree items（raw/<MM>/<name>.txt）
  const treeItems = files.map((file) => ({
    path: `raw/${getMonthDir(file.key, file.updatedAt)}/${file.key}`,
    mode: "100644",
    type: "blob",
    content: file.content
  }));

  // 4. 新しい tree
  const treeRes = await fetchFn(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems })
  });
  if (!treeRes.ok) {
    throw new Error(`Failed to create tree (${treeRes.status}): ${await treeRes.text()}`);
  }
  const newTreeSha = (await treeRes.json()).sha;

  // 5. 新しいコミット
  const first = files[0].key;
  const last = files[files.length - 1].key;
  const commitMessage = `chore(wiki): add ${files.length} memo(s) [${first}..${last}]`;
  const newCommitRes = await fetchFn(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message: commitMessage, tree: newTreeSha, parents: [latestCommitSha] })
  });
  if (!newCommitRes.ok) {
    throw new Error(`Failed to create commit (${newCommitRes.status}): ${await newCommitRes.text()}`);
  }
  const newCommitSha = (await newCommitRes.json()).sha;

  // 6. ブランチを更新
  const updateRefRes = await fetchFn(refUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ sha: newCommitSha })
  });
  if (!updateRefRes.ok) {
    throw new Error(`Failed to update ref ${branch} (${updateRefRes.status}): ${await updateRefRes.text()}`);
  }

  return { commitSha: newCommitSha, fileCount: files.length };
}

/**
 * GitHub トークンを解決する。
 */
export function resolveGitHubToken({ env = process.env, execFn = execFileSync } = {}) {
  if (env.CHIRA_GH_TOKEN) return env.CHIRA_GH_TOKEN;
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try {
    const out = execFn("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const token = String(out).trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * 未送信メモを 10 件ずつまとめて wiki へ push する。
 */
export async function syncWiki(db, options = {}) {
  const owner = options.owner || process.env.CHIRA_WIKI_OWNER || DEFAULT_OWNER;
  const repo = options.repo || process.env.CHIRA_WIKI_REPO || DEFAULT_REPO;
  const branch = options.branch || process.env.CHIRA_WIKI_BRANCH || DEFAULT_BRANCH;
  const batchSize = options.batchSize || WIKI_BATCH_SIZE;
  const fetchFn = options.fetchFn || fetch;
  const token = options.token || resolveGitHubToken();

  if (!token) {
    return { ok: false, pushed: 0, reason: "no_token" };
  }

  let pushed = 0;
  let commits = 0;

  for (;;) {
    const pending = getUnsyncedWikiNotes(db).slice(0, batchSize);
    if (!pending.length) break;

    const files = pending.map((n) => ({
      key: formatNoteFileName(n.updatedAt, n.id),
      content: n.content,
      updatedAt: n.updatedAt
    }));

    try {
      await pushFilesToGitHub({ files, owner, repo, branch, token, fetchFn });
    } catch (e) {
      // 失敗バッチは送信済みにせず、次回リトライに残す
      return { ok: false, pushed, commits, reason: "push_failed", error: String(e.message || e) };
    }

    for (const n of pending) markWikiSynced(db, n.id, n.updatedAt);
    pushed += pending.length;
    commits++;
  }

  return { ok: true, pushed, commits };
}
