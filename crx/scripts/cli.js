#!/usr/bin/env node
// chira-ura CLI — 設定専用（拡張内に設定画面は作らない）
// 鍵は平文 JSON に置く。拡張側は popup の「箱 → 鍵を読む」でこのファイルを読込む。

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KEYS_PATH = process.env.CHIRA_KEYS
  || join(homedir(), ".config", "chira-ura", "keys.json");

const BOXES = ["local", "gdrive", "gh", "box"];
const MANIFEST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "manifest.json");

function usage() {
  console.log(`chira-ura CLI

  chira set <key> <value>     非秘密の設定のみ（トークンは OAuth なので置かない）
                                 chira set gdrive.folderId <id>
                                 chira set gdrive.url https://script.google.com/...
                                 chira set auth.gh.clientId <id>
                                 chira set auth.box.clientId <id>
  chira get [key]             鍵を表示（key 省略で全部）
  chira box <${BOXES.join("|")}>
  chira client-id <id>.apps.googleusercontent.com   manifest の oauth2.client_id を書く
  chira path                  鍵ファイルのパス
  chira keys                  鍵ファイルの中身をそのまま表示

鍵ファイル（平文 JSON）: ${KEYS_PATH}
読込: popup → 箱 → 鍵を読む`);
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
  console.log(`saved: ${KEYS_PATH}`);
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
    break;
  }
  case "path":
    console.log(KEYS_PATH);
    break;
  case "keys":
    console.log(JSON.stringify(read(), null, 2));
    break;
  case "sync": {
    const sub = rest[0];
    if (!["pull", "push"].includes(sub)) {
      console.error("使い方: chira sync <pull|push>（未実装: 箱の同期は拡張側で行う）");
      process.exit(1);
    }
    console.error(`[stub] ${sub}: 同期は未実装。箱の設定だけ先に済ませる。`);
    process.exit(1);
  }
  default:
    usage();
    if (cmd) process.exit(1);
}
