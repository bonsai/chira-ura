#!/usr/bin/env node
// kami copi CLI — 設定・同期専用
// 拡張機能内には設定画面を作らない。すべてここから操作する。

import { execSync } from "node:child_process";

const CHROME_PATH = process.env.CHROME_PATH || "google-chrome";
const EXTENSION_ID = process.env.KAMI_EXTENSION_ID || ""; // chrome://extensions から確認

const args = process.argv.slice(2);
const cmd = args[0];
const sub = args[1];
const val = args.slice(2).join(" ");

function log(msg) { console.log(msg); }
function err(msg) { console.error(msg); process.exit(1); }

async function main() {
  switch (cmd) {
    case "set":
      await setConfig(sub, val);
      break;
    case "sync":
      await syncCommand(sub);
      break;
    case "id":
      log("拡張機能IDを環境変数 KAMI_EXTENSION_ID に設定してください");
      log("例: export KAMI_EXTENSION_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
      break;
    default:
      err("使い方: node cli.js set <key> <value> | sync <pull|push> | id");
  }
}

async function setConfig(key, value) {
  if (!key || !value) err("使い方: node cli.js set <key> <value>");
  switch (key) {
    case "gas-url":
    case "gas-url":
      log(`GAS URL: ${value}`);
      log("※ 拡張機能側の storage.db / background でこのURLを読み込むようにしてください（実装予定）");
      break;
    case "default-box":
      log(`デフォルト箱: ${value}`);
      break;
    case "autosave-interval":
      log(`自動保存間隔: ${value}ms`);
      break;
    default:
      err(`不明なキー: ${key}`);
  }
}

async function syncCommand(sub) {
  if (!EXTENSION_ID) {
    err("KAMI_EXTENSION_ID 環境変数を設定してください（chrome://extensions でIDを確認）");
  }
  switch (sub) {
    case "pull":
      log("GDrive(GAS) → ローカル に同期中...");
      await fetchFromGas("pull");
      break;
    case "push":
      log("ローカル → GDrive(GAS) に同期中...");
      await fetchFromGas("push");
      break;
    default:
      err("使い方: node cli.js sync <pull|push>");
  }
}

async function fetchFromGas(action) {
  // ※ 実際のGAS連携は、拡張機能側の background/service-worker.js または
  //    sidepanel/app.js から chrome.storage.local を介して行う。
  // CLI からは「拡張機能にメッセージを送って同期をトリガー」するか、
  // GAS の Web API を直接叩く実装をここに追加する。
  log(`[stub] ${action} 同期（GAS連携は拡張機能側で実装してください）`);
}

main().catch(err);
