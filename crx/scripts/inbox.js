// chira-ura — /inbox 送信クライアント
// dev/cloud-design.md §4・§5・§9-3
// 1分毎にセッション名（YYYYMMDD_HHMMSS.txt）で PUT /inbox/<name> へ送信

/**
 * タイムスタンプ YYYYMMDD_HHMMSS.txt を生成
 * @param {Date|number} [time]
 * @returns {string}
 */
export function formatSessionName(time = new Date()) {
  const d = time instanceof Date ? time : new Date(time);
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
 * 設定から inbox の URL とトークンを取得する
 * 実値は repo に書かず、storage.local の keys または環境設定から取得する。
 */
export async function getInboxConfig() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return { url: "", token: "" };
  }
  const res = await chrome.storage.local.get(["keys", "inboxUrl", "inboxToken"]);
  const keys = (res.keys && typeof res.keys === "object") ? res.keys : {};
  const url = res.inboxUrl || keys.inbox?.url || keys.inboxUrl || keys.apiUrl || "";
  const token = res.inboxToken || keys.inbox?.token || keys.inboxToken || keys.token || "";
  return { url: url.replace(/\/+$/, ""), token };
}

/**
 * /inbox/<name> へ PUT 送信
 * @param {Object} params
 * @param {string} params.name ファイル名（例: 20261105_120000.txt）
 * @param {string} params.content メモ本文
 * @param {number} params.updatedAt 更新ミリ秒
 * @param {boolean} [params.closed=false] クローズフラグ
 * @param {string} [params.url] 送信先ベース URL
 * @param {string} [params.token] 認証トークン
 * @param {boolean} [params.keepalive=false] ページ離脱時の keepalive 送信
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
export async function putInbox({ name, content, updatedAt, closed = false, url, token, keepalive = false }) {
  if (!name) throw new Error("filename is required");
  let targetUrl = url;
  let authToken = token;

  if (!targetUrl) {
    const conf = await getInboxConfig();
    targetUrl = conf.url;
    authToken = authToken || conf.token;
  }

  if (!targetUrl) {
    return { ok: false, error: "no_inbox_url" };
  }

  const endpoint = `${targetUrl.replace(/\/+$/, "")}/inbox/${encodeURIComponent(name)}`;
  const body = JSON.stringify({
    content: content ?? "",
    updatedAt: updatedAt || Date.now(),
    closed: Boolean(closed)
  });

  const headers = {
    "content-type": "application/json"
  };
  if (authToken) {
    headers["authorization"] = `Bearer ${authToken}`;
    headers["x-chira-token"] = authToken;
  }

  // 離脱時: まず fetch with keepalive を試行（PUT およびヘッダ送信が可能）
  // fetch(keepalive) が失敗または未対応の場合に sendBeacon へフォールバック
  try {
    const res = await fetch(endpoint, {
      method: "PUT",
      headers,
      body,
      keepalive: Boolean(keepalive),
      cache: "no-store"
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    if (keepalive && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const blob = new Blob([body], { type: "application/json" });
        const sent = navigator.sendBeacon(endpoint, blob);
        if (sent) return { ok: true, beacon: true };
      } catch (_) {}
    }
    return { ok: false, error: err?.message || "network_error" };
  }
}
