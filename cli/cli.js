#!/usr/bin/env node
// chira-ura CLI — 設定 + ブリッジ（GDrive が正）
// 鍵は平文 JSON（非秘密のみ）。トークンは OAuth なので置かない。
//
// 同期の意味はひとつ: 「GDrive が正」。CLI は GDrive を映したミラーを配り、
// 拡張はそれを pull するだけ。拡張側の値を正にしない。

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KEYS_PATH = process.env.CHIRA_KEYS
  || join(homedir(), ".config", "chira-ura", "keys.json");

const MANIFEST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "crx", "manifest.json");
const BOXES = ["local", "gdrive", "gh", "box"];
const PORT = Number(process.env.CHIRA_PORT || 8787);

// ---------- OAuth（CLI も同じクライアントを使う） ----------
const TOKEN_PATH = join(dirname(KEYS_PATH), "token.json");
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function clientCreds() {
  const keys = read();
  const man = (() => {
    try { return JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { return {}; }
  })();
  const clientId = keys.oauth?.clientId || man.oauth2?.client_id || "";
  const clientSecret = keys.oauth?.clientSecret || "";
  if (!clientId || clientId.startsWith("REPLACE_ME")) {
    throw new Error("client_id 未設定: chira client-id <id> か chira set oauth.clientId <id>");
  }
  return { clientId, clientSecret };
}

function readToken() {
  if (!existsSync(TOKEN_PATH)) return null;
  try { return JSON.parse(readFileSync(TOKEN_PATH, "utf8")); } catch { return null; }
}

function writeToken(tok) {
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(tok, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => {});
}

async function exchange(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || "token exchange failed");
  return json;
}

/** ブラウザ同意 → ループバックでコードを受けて保存（PKCE） */
async function oauthLogin() {
  const { clientId, clientSecret } = clientCreds();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  const port = 8799;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const err = u.searchParams.get("error");
      const c = u.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<p>chira-ura: ${err ? "認可に失敗" : "認可しました。ターミナルに戻る"}</p>`);
      server.close();
      if (err) reject(new Error(err));
      else if (u.searchParams.get("state") !== state) reject(new Error("state 不一致"));
      else resolve(c);
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.log("ブラウザで同意する（30 秒待つ）...");
      openBrowser(url.toString());
    });
    setTimeout(() => { server.close(); reject(new Error("タイムアウト")); }, 180000).unref();
  });

  const tok = await exchange({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier
  });
  writeToken({ ...tok, at: Date.now() });
  console.log(`authorized (scope: ${tok.scope || SCOPES.join(" ")})`);
  console.log(`token: ${TOKEN_PATH}`);
}

/** 有効な access token（期限切れは refresh） */
async function accessToken() {
  const tok = readToken();
  if (!tok) throw new Error("未認証: chira auth");
  const fresh = tok.access_token && tok.expires_in && tok.at + (tok.expires_in - 60) * 1000 > Date.now();
  if (fresh) return tok.access_token;
  if (!tok.refresh_token) throw new Error("再認証が必要: chira auth");
  const { clientId, clientSecret } = clientCreds();
  const next = await exchange({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tok.refresh_token,
    grant_type: "refresh_token"
  });
  writeToken({ ...tok, ...next, at: Date.now() });
  return next.access_token;
}

function usage() {
  console.log(`chira-ura CLI

  chira set <key> <value>     非秘密の設定のみ（トークンは OAuth なので置かない）
                                 chira set gdrive.folderId <id>
                                 chira set gdrive.url https://script.google.com/...
                                 chira set auth.gh.clientId <id>
  chira get [key]
  chira box [${BOXES.join("|")}]   引数なしで現在の箱を表示
  chira client-id <id>.apps.googleusercontent.com   manifest の oauth2.client_id
  chira path | keys
  chira auth                  OAuth（ブラウザ同意 → token.json, 0600）
  chira logout                トークン削除
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
    if (!id) {
      console.log(read().box || "gdrive");
      break;
    }
    if (!BOXES.includes(id)) {
      console.error(`使い方: chira box <${BOXES.join("|")}>  （引数なしで現在値を表示）`);
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
  case "auth":
    oauthLogin().catch((e) => { console.error(e.message); process.exit(1); });
    break;
  case "logout":
    if (existsSync(TOKEN_PATH)) { writeFileSync(TOKEN_PATH, "{}\n"); console.log("logged out"); }
    else console.log("token なし");
    break;
  case "token":
    accessToken().then((t) => console.log(t)).catch((e) => { console.error(e.message); process.exit(1); });
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
