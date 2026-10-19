#!/usr/bin/env node
// chira-ura CLI — 設定 + ブリッジ（GDrive が正）
// 鍵は平文 JSON（非秘密のみ）。トークンは OAuth なので置かない。
//
// 同期の意味はひとつ: 「GDrive が正」。CLI は GDrive を映したミラーを配り、
// 拡張はそれを pull するだけ。拡張側の値を正にしない。

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KEYS_PATH = process.env.CHIRA_KEYS
  || join(homedir(), ".config", "chira-ura", "keys.json");

const MANIFEST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "crx", "manifest.json");
const BOXES = ["local", "gdrive", "gh", "box"];
const PORT = Number(process.env.CHIRA_PORT || 8787);

function usage() {
  console.log(`chira-ura CLI

  chira set <key> <value>     非秘密の設定のみ（トークンは OAuth なので置かない）
                                 chira set gdrive.folderId <id>
                                 chira set gdrive.url https://script.google.com/...
                                 chira set auth.gh.clientId <id>
  chira get [key]
  chira box <${BOXES.join("|")}>
  chira client-id <id>.apps.googleusercontent.com   manifest の oauth2.client_id
  chira path | keys
  chira serve [--port N]      ブリッジを立てる（拡張が pull する）
  chira pull                  ブリッジから keys.json へ（= sync）
  chira push                  keys.json をブリッジへ（GDrive ミラーとして）
  chira sync                  意味は「GDrive が正」= pull と同じ

鍵ファイル（平文 JSON）: ${KEYS_PATH}`);
}

function read() {
  if (!existsSync(KEYS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(KEYS_PATH, "utf8"));
  } catch (e) {
    console.error(`壊れた JSON: ${KEYS_PATH}`);
    process.exit(1);
  }
}

function write(obj) {
  mkdirSync(dirname(KEYS_PATH), { recursive: true });
  writeFileSync(KEYS_PATH, JSON.stringify(obj, null, 2) + "\n", "utf8");
  return obj;
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function getPath(obj, path) {
  return path.split(".").reduce((a, k) => (a == null ? a : a[k]), obj);
}

// ---------- ブリッジ state（GDrive ミラー） ----------
function toState() {
  const keys = read();
  return {
    rev: Number(keys.rev || 0),
    source: "gdrive",
    box: keys.box || "gdrive",
    gasUrl: keys.gdrive?.url || "",
    keys
  };
}

function fromState(state) {
  const cur = read();
  const next = {
    ...cur,
    ...(state.keys || {}),
    box: state.box || "gdrive",
    rev: Number(state.rev ?? cur.rev ?? 0),
    source: "gdrive"
  };
  if (state.gasUrl) next.gdrive = { ...(next.gdrive || {}), url: state.gasUrl };
  return write(next);
}

async function pull() {
  const res = await fetch(`http://127.0.0.1:${PORT}/state`, { cache: "no-store" });
  if (!res.ok) throw new Error(`bridge ${res.status}`);
  fromState(await res.json());
  console.log(`pulled (GDrive が正): ${KEYS_PATH}`);
}

async function push() {
  const body = JSON.stringify(toState());
  const res = await fetch(`http://127.0.0.1:${PORT}/state`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body
  });
  if (!res.ok) throw new Error(`bridge ${res.status}`);
  console.log("pushed（GDrive ミラーとして）");
}

function serve(port) {
  const server = createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };

    if (req.url?.startsWith("/state") && req.method === "GET") {
      return send(200, toState());
    }

    if (req.url?.startsWith("/state") && (req.method === "PUT" || req.method === "POST")) {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        try {
          const state = JSON.parse(raw || "{}");
          const next = fromState({ ...state, rev: Number(toState().rev) + 1 });
          send(200, { ok: true, rev: next.rev });
        } catch (e) {
          send(400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }

    send(404, { ok: false });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`bridge: http://127.0.0.1:${port}/state  (GDrive が正)`);
    console.log(`keys: ${KEYS_PATH}`);
  });
  return server;
}

// ---------- コマンド ----------
const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "set": {
    const [key, ...val] = rest;
    const value = val.join(" ");
    if (!key || !value) {
      console.error("使い方: chira set <key> <value>");
      process.exit(1);
    }
    write(setPath(read(), key, value));
    console.log(`saved: ${KEYS_PATH}`);
    break;
  }
  case "get": {
    const keys = read();
    const out = rest[0] ? getPath(keys, rest[0]) : keys;
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
    break;
  }
  case "client-id": {
    const id = rest[0];
    if (!id || !id.includes(".apps.googleusercontent.com")) {
      console.error("使い方: chira client-id <id>.apps.googleusercontent.com");
      process.exit(1);
    }
    const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
    m.oauth2 = { ...(m.oauth2 || {}), client_id: id };
    writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n", "utf8");
    console.log(`oauth2.client_id -> ${id}`);
    console.log("chrome://extensions で再読み込み");
    break;
  }
  case "box": {
    const id = rest[0];
    if (!BOXES.includes(id)) {
      console.error(`使い方: chira box <${BOXES.join("|")}>`);
      process.exit(1);
    }
    write(setPath(read(), "box", id));
    console.log(`box -> ${id}`);
    break;
  }
  case "path":
    console.log(KEYS_PATH);
    break;
  case "keys":
    console.log(JSON.stringify(read(), null, 2));
    break;
  case "serve": {
    const i = rest.indexOf("--port");
    const port = i >= 0 ? Number(rest[i + 1]) : PORT;
    serve(port);
    break;
  }
  case "pull":
  case "sync":
    pull().catch((e) => { console.error(e.message); process.exit(1); });
    break;
  case "push":
    push().catch((e) => { console.error(e.message); process.exit(1); });
    break;
  default:
    usage();
    if (cmd) process.exit(1);
}
