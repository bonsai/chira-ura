/**
 * mcp.js - Model Context Protocol (Streamable HTTP) implementation
 *
 * Implements MCP 2026-07-28 (with backwards-compat for initialize):
 * - server/discover / initialize
 * - tools/list
 * - tools/call
 *
 * Tools:
 * - chira_note_add(content)
 * - chira_inbox_list()
 * - chira_count()
 * - chira_wiki_list_raw(month?)
 * - chira_wiki_read(path)
 * - chira_wiki_search(query)
 */

import { listAllKeys } from "./wiki-push.js";

const PROTOCOL_VERSION = "2026-07-28";
const GITHUB_API_BASE = "https://api.github.com";
const REPO_OWNER = "bonsai";
const REPO_NAME = "wiki";
const BRANCH = "master";

export const TOOLS = [
  {
    name: "chira_note_add",
    title: "Chira: Add Note",
    description: "Write a note into inbox cache (KV) as an unclosed memo. Does not push directly to wiki.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Content of the note"
        }
      },
      required: ["content"]
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false
    }
  },
  {
    name: "chira_inbox_list",
    title: "Chira: List Inbox",
    description: "List notes currently stored in the inbox cache (KV).",
    inputSchema: {
      type: "object",
      properties: {}
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: "chira_count",
    title: "Chira: Count Memos",
    description: "Get the count and last received timestamp of notes in the inbox cache.",
    inputSchema: {
      type: "object",
      properties: {}
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: "chira_wiki_list_raw",
    title: "Chira: List Wiki Raw Notes",
    description: "List raw note file paths stored in bonsai/wiki master branch. Optionally filter by two-digit month (e.g. '04').",
    inputSchema: {
      type: "object",
      properties: {
        month: {
          type: "string",
          description: "Optional 2-digit month (01-12) to list under raw/<month>/"
        }
      }
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: "chira_wiki_read",
    title: "Chira: Read Wiki Note",
    description: "Read the full text content of a note at path in bonsai/wiki (e.g. 'raw/04/20260415_120000.txt').",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path in bonsai/wiki, such as 'raw/04/filename.txt'"
        }
      },
      required: ["path"]
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: "chira_wiki_search",
    title: "Chira: Search Wiki Notes",
    description: "Search for past notes in bonsai/wiki raw/ directory matching the query string.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keyword or query to search in wiki/raw notes"
        }
      },
      required: ["query"]
    },
    annotations: {
      readOnlyHint: true
    }
  }
];

function generateTimestampFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}.txt`;
}

function rpcResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      resultType: "complete",
      ...result
    }
  };
}

function rpcError(id, code, message, data) {
  const res = {
    jsonrpc: "2.0",
    id: id !== undefined ? id : null,
    error: {
      code,
      message
    }
  };
  if (data !== undefined) {
    res.error.data = data;
  }
  return res;
}

/**
 * Handle tools/call execution
 */
async function handleToolCall(name, args, env, fetchFn = fetch) {
  const kv = env.INBOX;

  switch (name) {
    case "chira_note_add": {
      if (!kv) {
        throw new Error("KV namespace INBOX not bound");
      }
      const content = typeof args.content === "string" ? args.content : "";
      const filename = generateTimestampFilename();
      const updatedAt = Date.now();
      const closed = false;

      const record = {
        name: filename,
        content,
        updatedAt,
        closed
      };
      const expirationTtl = env.KV_TTL ? parseInt(env.KV_TTL, 10) : 7 * 86400;
      await kv.put(filename, JSON.stringify(record), { expirationTtl });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, name: filename, updatedAt, closed }, null, 2)
          }
        ]
      };
    }

    case "chira_inbox_list": {
      if (!kv) {
        throw new Error("KV namespace INBOX not bound");
      }
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ items, count: items.length }, null, 2)
          }
        ]
      };
    }

    case "chira_count": {
      if (!kv) {
        throw new Error("KV namespace INBOX not bound");
      }
      const keys = await listAllKeys(kv);
      let lastReceived = null;
      for (const entry of keys) {
        const raw = await kv.get(entry.name);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.updatedAt && (!lastReceived || parsed.updatedAt > lastReceived)) {
              lastReceived = parsed.updatedAt;
            }
          } catch {}
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: keys.length,
                lastReceived: lastReceived ? new Date(lastReceived).toISOString() : null
              },
              null,
              2
            )
          }
        ]
      };
    }

    case "chira_wiki_list_raw": {
      const token = env.GITHUB_TOKEN;
      if (!token) {
        throw new Error("GITHUB_TOKEN not configured");
      }
      const owner = env.GITHUB_REPO_OWNER || REPO_OWNER;
      const repo = env.GITHUB_REPO_NAME || REPO_NAME;
      const branch = env.GITHUB_BRANCH || BRANCH;

      let month = args.month ? String(args.month).trim() : null;
      if (month && month.length === 1) month = "0" + month;

      // Use Git tree API (recursive) to list files under raw/
      const treeUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
      const res = await fetchFn(treeUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "chira-ura-worker"
        }
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`GitHub API error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const prefix = month ? `raw/${month}/` : `raw/`;
      const files = (data.tree || [])
        .filter((item) => item.type === "blob" && item.path.startsWith(prefix))
        .map((item) => item.path);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ files, count: files.length, prefix }, null, 2)
          }
        ]
      };
    }

    case "chira_wiki_read": {
      const token = env.GITHUB_TOKEN;
      if (!token) {
        throw new Error("GITHUB_TOKEN not configured");
      }
      const owner = env.GITHUB_REPO_OWNER || REPO_OWNER;
      const repo = env.GITHUB_REPO_NAME || REPO_NAME;
      const branch = env.GITHUB_BRANCH || BRANCH;

      let path = (args.path || "").trim().replace(/^\/+/, "");
      if (!path) {
        throw new Error("Path is required");
      }

      const contentsUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
      const res = await fetchFn(contentsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "chira-ura-worker"
        }
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`GitHub API error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      let text = "";
      if (data.content && data.encoding === "base64") {
        // Decode base64 to utf-8 text properly (avoid atob Latin-1 mojibake with multi-byte text)
        const cleanBase64 = data.content.replace(/\s+/g, "");
        if (typeof Buffer !== "undefined") {
          text = Buffer.from(cleanBase64, "base64").toString("utf-8");
        } else {
          const binary = atob(cleanBase64);
          const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          text = new TextDecoder().decode(bytes);
        }
      } else if (typeof data === "string") {
        text = data;
      }

      return {
        content: [
          {
            type: "text",
            text
          }
        ]
      };
    }

    case "chira_wiki_search": {
      const token = env.GITHUB_TOKEN;
      if (!token) {
        throw new Error("GITHUB_TOKEN not configured");
      }
      const owner = env.GITHUB_REPO_OWNER || REPO_OWNER;
      const repo = env.GITHUB_REPO_NAME || REPO_NAME;
      const branch = env.GITHUB_BRANCH || BRANCH;

      const query = (args.query || "").trim();
      if (!query) {
        throw new Error("Query is required");
      }

      // First attempt: GitHub code search API
      const searchUrl = `${GITHUB_API_BASE}/search/code?q=${encodeURIComponent(
        `${query} repo:${owner}/${repo} path:raw`
      )}`;

      const res = await fetchFn(searchUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "chira-ura-worker"
        }
      });

      if (res.ok) {
        const data = await res.json();
        const items = (data.items || []).map((it) => ({
          path: it.path,
          name: it.name,
          sha: it.sha
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ matches: items, total_count: data.total_count }, null, 2)
            }
          ]
        };
      }

      // Fallback: If Code search is unavailable or returns 403/422/etc.,
      // fetch git tree for raw/ and search files manually
      const treeUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
      const treeRes = await fetchFn(treeUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "chira-ura-worker"
        }
      });

      if (!treeRes.ok) {
        const errText = await treeRes.text();
        throw new Error(`GitHub API error (${treeRes.status}): ${errText}`);
      }

      const treeData = await treeRes.json();
      const rawBlobs = (treeData.tree || []).filter(
        (it) => it.type === "blob" && it.path.startsWith("raw/")
      );

      const matches = [];
      const queryLower = query.toLowerCase();

      for (const blob of rawBlobs) {
        // Path match
        if (blob.path.toLowerCase().includes(queryLower)) {
          matches.push({ path: blob.path, matchedBy: "path" });
          continue;
        }

        // Fetch blob content to search within file
        try {
          const blobRes = await fetchFn(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs/${blob.sha}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "chira-ura-worker"
            }
          });
          if (blobRes.ok) {
            const blobData = await blobRes.json();
            const cleanBase64 = blobData.content.replace(/\s+/g, "");
            let text = "";
            if (typeof Buffer !== "undefined") {
              text = Buffer.from(cleanBase64, "base64").toString("utf-8");
            } else {
              const binary = atob(cleanBase64);
              const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
              text = new TextDecoder().decode(bytes);
            }
            if (text.toLowerCase().includes(queryLower)) {
              const snippet = text
                .split("\n")
                .filter((line) => line.toLowerCase().includes(queryLower))
                .slice(0, 3)
                .join("\n");
              matches.push({ path: blob.path, matchedBy: "content", snippet });
            }
          }
        } catch {}
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ matches, total_count: matches.length }, null, 2)
          }
        ]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Handle incoming MCP POST request
 */
export async function handleMcpRequest(request, env, fetchFn = fetch) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, "Parse error")), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Notification handling: if no id, per spec return 202 Accepted
  if (body.id === undefined) {
    return new Response(null, { status: 202 });
  }

  const { id, method, params = {} } = body;

  try {
    switch (method) {
      case "server/discover":
      case "initialize": {
        const result = {
          supportedVersions: [PROTOCOL_VERSION, "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"],
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          serverInfo: {
            name: "chira-mcp",
            version: "0.1.8"
          },
          _meta: {
            "io.modelcontextprotocol/serverInfo": {
              name: "chira-mcp",
              version: "0.1.8"
            }
          },
          instructions: "Chira: ultra-minimal scratchpad MCP server for inbox memo capture and wiki/raw retrieval."
        };
        return new Response(JSON.stringify(rpcResponse(id, result)), {
          headers: { "Content-Type": "application/json" }
        });
      }

      case "tools/list": {
        const result = {
          tools: TOOLS,
          _meta: {
            "io.modelcontextprotocol/serverInfo": {
              name: "chira-mcp",
              version: "0.1.8"
            }
          }
        };
        return new Response(JSON.stringify(rpcResponse(id, result)), {
          headers: { "Content-Type": "application/json" }
        });
      }

      case "tools/call": {
        const toolName = params.name;
        const toolArgs = params.arguments || {};

        const tool = TOOLS.find((t) => t.name === toolName);
        if (!tool) {
          return new Response(JSON.stringify(rpcError(id, -32602, `Unknown tool: ${toolName}`)), {
            headers: { "Content-Type": "application/json" }
          });
        }

        try {
          const callResult = await handleToolCall(toolName, toolArgs, env, fetchFn);
          return new Response(
            JSON.stringify(
              rpcResponse(id, {
                content: callResult.content,
                isError: false,
                _meta: {
                  "io.modelcontextprotocol/serverInfo": {
                    name: "chira-mcp",
                    version: "0.1.8"
                  }
                }
              })
            ),
            {
              headers: { "Content-Type": "application/json" }
            }
          );
        } catch (toolErr) {
          // MCP tool execution errors should be returned inside the result object with isError: true
          return new Response(
            JSON.stringify(
              rpcResponse(id, {
                content: [
                  {
                    type: "text",
                    text: `Error executing ${toolName}: ${toolErr.message}`
                  }
                ],
                isError: true
              })
            ),
            {
              headers: { "Content-Type": "application/json" }
            }
          );
        }
      }

      default:
        return new Response(JSON.stringify(rpcError(id, -32601, `Method not found: ${method}`)), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
    }
  } catch (err) {
    return new Response(JSON.stringify(rpcError(id, -32603, `Internal error: ${err.message}`)), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
