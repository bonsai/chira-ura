// Cloudflare Worker FE API for chira-ura
// 設計: dev/cloud-design.md §5
//
// エンドポイント:
//   PUT /inbox/<name>: 本文 + updatedAt + closed を KV に同名上書き保存
//   GET /inbox: キャッシュ一覧（名前・タイトル・更新時刻・closed）
//   GET /count: 件数と最終受信時刻（死活確認用）
//
// 認証:
//   Authorization: Bearer <token> または X-Chira-Token: <token>
//   実値は wrangler secret put CHIRA_TOKEN で投入された env.CHIRA_TOKEN と比較

export function deriveTitle(content) {
  const line = (content || "").split("\n").map(s => s.trim()).find(Boolean) || "";
  return line.slice(0, 30) || "無題";
}

export function authenticate(request, env) {
  const secret = env?.CHIRA_TOKEN;
  if (!secret) {
    // トークン未設定時は拒否
    return false;
  }

  const authHeader = request.headers.get("Authorization") || "";
  let token = null;
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else {
    token = request.headers.get("X-Chira-Token")?.trim();
  }

  return Boolean(token && token === secret);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // 認証チェック
    if (!authenticate(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const kv = env.INBOX;
    if (!kv) {
      return jsonResponse({ error: "KV namespace INBOX not bound" }, 500);
    }

    // PUT /inbox/<name>
    if (method === "PUT" && pathname.startsWith("/inbox/")) {
      const name = decodeURIComponent(pathname.slice("/inbox/".length));
      if (!name) {
        return jsonResponse({ error: "Name is required" }, 400);
      }

      let body;
      try {
        body = await request.json();
      } catch (_) {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      const content = typeof body.content === "string" ? body.content : "";
      const updatedAt = Number(body.updatedAt) || Date.now();
      const closed = Boolean(body.closed);
      const title = (typeof body.title === "string" && body.title.trim())
        ? body.title.trim().slice(0, 30)
        : deriveTitle(content);

      const metadata = {
        name,
        title,
        updatedAt,
        closed
      };

      const record = {
        name,
        title,
        content,
        updatedAt,
        closed
      };

      // KV に保存。metadata も付与して list 時に value fetch を不要にする
      // TTL 7 日 (604800 秒)
      await kv.put(name, JSON.stringify(record), {
        metadata,
        expirationTtl: 604800
      });

      return jsonResponse({ ok: true, name, title, updatedAt, closed }, 200);
    }

    // GET /inbox
    if (method === "GET" && pathname === "/inbox") {
      const list = await kv.list();
      const items = [];

      for (const key of list.keys) {
        if (key.metadata) {
          items.push({
            name: key.name,
            title: key.metadata.title || "無題",
            updatedAt: key.metadata.updatedAt || 0,
            closed: Boolean(key.metadata.closed)
          });
        } else {
          // metadata がない場合は値を取得して復元
          try {
            const raw = await kv.get(key.name);
            const parsed = raw ? JSON.parse(raw) : null;
            items.push({
              name: key.name,
              title: parsed?.title || deriveTitle(parsed?.content) || "無題",
              updatedAt: parsed?.updatedAt || 0,
              closed: Boolean(parsed?.closed)
            });
          } catch (_) {
            items.push({
              name: key.name,
              title: "無題",
              updatedAt: 0,
              closed: false
            });
          }
        }
      }

      // 更新時刻の新しい順にソート
      items.sort((a, b) => b.updatedAt - a.updatedAt);

      return jsonResponse(items, 200);
    }

    // GET /count
    if (method === "GET" && pathname === "/count") {
      const list = await kv.list();
      let lastReceivedAt = 0;

      for (const key of list.keys) {
        const time = key.metadata?.updatedAt;
        if (time && time > lastReceivedAt) {
          lastReceivedAt = time;
        } else if (!key.metadata) {
          try {
            const raw = await kv.get(key.name);
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed?.updatedAt && parsed.updatedAt > lastReceivedAt) {
              lastReceivedAt = parsed.updatedAt;
            }
          } catch (_) {}
        }
      }

      return jsonResponse({
        count: list.keys.length,
        lastReceivedAt: lastReceivedAt || null
      }, 200);
    }

    return jsonResponse({ error: "Not Found" }, 404);
  }
};
