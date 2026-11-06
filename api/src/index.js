/**
 * Cloudflare Worker: chira-ura FE API + Cron Hourly Batch + MCP
 *
 * Endpoints:
 * - PUT /inbox/<name>: writes memo { content, updatedAt, closed } into KV (INBOX)
 * - GET /inbox: list cache items -> { items, count } (sorted by updatedAt desc)
 * - GET /count: { count, lastReceivedAt } (ISO string, liveness check)
 * - POST /mcp: Streamable HTTP MCP endpoint
 * - POST /cron/flush: manually trigger flush of closed files to bonsai/wiki
 *
 * Scheduled event:
 * - 0 * * * * (hourly): triggers flushClosedFiles(env)
 */

import { flushClosedFiles, listAllKeys } from "./wiki-push.js";
import { handleMcpRequest } from "./mcp.js";

/**
 * Checks bearer token / X-Chira-Token against API_TOKEN (or legacy CHIRA_TOKEN).
 * If neither token is configured, allow (dev / unconfigured mode).
 */
function isAuthorized(request, env) {
  const token = env.API_TOKEN || env.CHIRA_TOKEN;
  if (!token) {
    return true;
  }
  const authHeader = request.headers.get("Authorization") || "";
  const chiraHeader = request.headers.get("X-Chira-Token") || "";

  let tokenProvided = null;
  if (authHeader.startsWith("Bearer ")) {
    tokenProvided = authHeader.slice(7).trim();
  } else {
    tokenProvided = chiraHeader.trim();
  }
  return Boolean(tokenProvided && tokenProvided === token);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Chira-Token"
    }
  });
}

/**
 * Helper: extract first non-empty line up to 30 chars for a title.
 */
export function deriveTitle(content) {
  const line = (content || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  return line.slice(0, 30) || "無題";
}

/**
 * Helper: authenticate using Bearer or X-Chira-Token against CHIRA_TOKEN env.
 */
export function authenticate(request, env) {
  const secret = env?.CHIRA_TOKEN;
  if (!secret) {
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

export default {
  /**
   * Cron Trigger Handler (Hourly)
   */
  async scheduled(event, env, ctx) {
    console.log(`[Cron] Scheduled batch started at ${new Date().toISOString()}`);
    try {
      const result = await flushClosedFiles({ env });
      console.log(`[Cron] Batch completed successfully:`, result);
    } catch (err) {
      console.error(`[Cron] Batch failed:`, err);
    }
  },

  /**
   * Fetch Handler
   */
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Chira-Token"
        }
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Check authorization for all endpoints except OPTIONS
    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // POST /mcp (Streamable HTTP MCP endpoint)
    if (pathname === "/mcp" || pathname === "/mcp/") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "POST" }
        });
      }
      return handleMcpRequest(request, env);
    }

    const kv = env.INBOX;
    if (!kv) {
      return jsonResponse({ error: "KV namespace INBOX not bound" }, 500);
    }

    // PUT /inbox/<name>
    if (request.method === "PUT" && pathname.startsWith("/inbox/")) {
      const name = decodeURIComponent(pathname.slice("/inbox/".length));
      if (!name) {
        return jsonResponse({ error: "Filename is required" }, 400);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      const content = typeof body.content === "string" ? body.content : "";
      const updatedAt = body.updatedAt || Date.now();
      const closed = body.closed === true;

      const record = {
        name,
        content,
        updatedAt,
        closed
      };

      // KV expiration TTL (default 7 days: 604800 seconds)
      const expirationTtl = env.KV_TTL ? parseInt(env.KV_TTL, 10) : 7 * 86400;

      await kv.put(name, JSON.stringify(record), { expirationTtl });
      return jsonResponse({
        ok: true,
        name,
        title: deriveTitle(content),
        updatedAt,
        closed
      });
    }

    // GET /inbox
    if (request.method === "GET" && (pathname === "/inbox" || pathname === "/inbox/")) {
      const keys = await listAllKeys(kv);
      const items = [];
      for (const entry of keys) {
        const raw = await kv.get(entry.name);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          const firstLine = (parsed.content || "").split("\n")[0].trim().slice(0, 30);
          items.push({
            name: entry.name,
            title: firstLine || "無題",
            updatedAt: parsed.updatedAt,
            closed: !!parsed.closed
          });
        } catch {
          items.push({ name: entry.name, title: "無題", updatedAt: null, closed: false });
        }
      }
      items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return jsonResponse({ items, count: items.length });
    }

    // GET /count
    if (request.method === "GET" && pathname === "/count") {
      const keys = await listAllKeys(kv);
      let lastReceivedAt = 0;
      for (const entry of keys) {
        const raw = await kv.get(entry.name);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed.updatedAt && parsed.updatedAt > lastReceivedAt) {
            lastReceivedAt = parsed.updatedAt;
          }
        } catch {}
      }
      return jsonResponse({
        count: keys.length,
        lastReceivedAt: lastReceivedAt ? new Date(lastReceivedAt).toISOString() : null
      });
    }

    // POST /cron/flush (manual trigger for cron batch)
    if (request.method === "POST" && pathname === "/cron/flush") {
      try {
        const result = await flushClosedFiles({ env });
        return jsonResponse({ ok: true, result });
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 500);
      }
    }

    return jsonResponse({ error: "Not Found" }, 404);
  }
};
