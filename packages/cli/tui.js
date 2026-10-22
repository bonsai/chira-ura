#!/usr/bin/env node
// chira-ura TUI — ターミナル UI でメモを閲覧・編集
// 実体: packages/cli/tui.js（node:readline + tty）

import { openDb, listNotes, getNote, addNote, removeNote, DB_PATH } from "./ura-db.js";

const STICK = { left: "▌", right: "▐" };
const DOT = "•";

// ---------- 端末サイズ ----------
const width = process.stdout.columns || 80;
const height = process.stdout.rows || 24;

// ---------- ANSI ヘルパー ----------
const esc = (code) => `\x1b[${code}m`;
const cls = "\x1b[2J\x1b[H";
const hide = "\x1b[?25l";
const show = "\x1b[?25h";
const clearLine = "\x1b[2K";
const go = (r, c) => `\x1b[${r};${c}H`;
const bold = esc("1");
const dim = esc("2");
const rev = esc("7");
const reset = esc("0");
const cyan = esc("36");
const green = esc("32");
const yellow = esc("33");
const magenta = esc("35");
const red = esc("31");

// ---------- 状態 ----------
let mode = "list"; // list | view | edit | add | confirm
let notes = [];
let idx = 0;
let inputBuf = "";
let scrollY = 0;
let viewNote = null; // { id, title, content, updatedAt } | null
let addingTitle = false;
let confirmTarget = null;

// ---------- DB パス ----------
let DB_LOC = process.env.CHIRA_DB || process.env.CHIRA_LOAD_DIR ? "" : "";
try {
  const { openDb: _ } = await import("./ura-db.js");
} catch {}
console.log("TUI: CHIRA_LOAD_DIR 未指定の場合は デフォルトパスを使用します");

// ---------- 描画 ----------
function wrap(text, w) {
  const lines = [];
  for (const para of text.split("\n")) {
    if (para.length === 0) { lines.push(""); continue; }
    while (para.length > w) { lines.push(para.slice(0, w)); para = para.slice(w); }
    lines.push(para);
  }
  return lines;
}

function render() {
  process.stdout.write(cls + hide);
  const W = process.stdout.columns || width;
  const H = process.stdout.rows || height;
  const rows = Math.max(5, H);

  // ヘッダー
  const title = ` chira-ura TUI — ${mode.toUpperCase()} `;
  const headLine = `${bold}${cyan}${title}${reset}${dim} ${notes.length} 件${reset}  ${dim}DB: ${DB_PATH.replace(/\//g, "").slice(-24)}${reset}`;
  process.stdout.write(go(1, 1) + headLine.padEnd(W).slice(0, W) + "\n");

  if (mode === "list") renderList(W, H);
  else if (mode === "view") renderView(W, H);
  else if (mode === "edit") renderEdit(W, H);
  else if (mode === "add") renderAdd(W, H);
  else if (mode === "confirm") renderConfirm(W, H);

  // フッター
  const help = mode === "list"
    ? `${green}↑↓${reset}移動 ${green}Enter${reset}開く ${green}+${reset}追加 ${green}d${reset}削除 ${green}q${reset}終了`
    : `${green}Ctrl+C${reset}中止 ${green}Enter${reset}保存`;
  process.stdout.write(go(rows, 1) + dim + help.padEnd(W).slice(0, W) + reset);
  process.stdout.write(show);
}

function renderList(W, H) {
  if (notes.length === 0) {
    process.stdout.write(go(3, 1) + dim + "メモがありません。 + で追加" + reset);
    return;
  }
  const start = Math.max(0, idx - Math.floor((H - 6) / 2));
  const end = Math.min(notes.length, start + (H - 6));
  for (let i = start; i < end; i++) {
    const n = notes[i];
    const marker = i === idx ? `${rev} ${n.title} ${reset}` : `  ${n.title}`;
    process.stdout.write(go(3 + (i - start), 1) + clearLine + (i === idx ? bold : "") + marker.slice(0, W - 4) + reset + "\n");
  }
}

function renderView(W, H) {
  const n = viewNote;
  if (!n) return;
  process.stdout.write(go(3, 1) + bold + n.title + reset + "\n");
  process.stdout.write(go(4, 1) + dim + new Date(n.updatedAt).toLocaleString() + reset + "\n\n");
  const bodyLines = wrap(n.content, W - 2);
  const viewH = Math.max(3, H - 8);
  for (let i = 0; i < viewH; i++) {
    const li = scrollY + i;
    if (li >= bodyLines.length) break;
    process.stdout.write(go(6 + i, 1) + clearLine + bodyLines[li].slice(0, W - 2) + "\n");
  }
  if (bodyLines.length > viewH) {
    process.stdout.write(go(H - 2, 1) + dim + `スクロール: ${Math.min(scrollY + viewH, bodyLines.length)} / ${bodyLines.length}` + reset);
  }
}

function renderEdit(W, H) {
  const n = viewNote || { title: "", content: "", id: "", updatedAt: "" };
  process.stdout.write(go(3, 1) + bold + (addingTitle ? "タイトル: " : "本文: ") + reset + inputBuf + "\n");
  const lines = wrap(inputBuf, W - 4);
  const editH = Math.max(4, H - 8);
  const start = Math.max(0, lines.length - editH);
  for (let i = start; i < lines.length; i++) {
    process.stdout.write(go(5 + (i - start), 1) + clearLine + lines[i].slice(0, W - 4) + "\n");
  }
}

function renderAdd(W, H) {
  process.stdout.write(go(3, 1) + bold + "新規メモ タイトル: " + reset + inputBuf + "\n");
}

function renderConfirm(W, H) {
  const n = confirmTarget;
  process.stdout.write(go(3, 1) + red + `削除します: ${n.title}？` + reset + "\n");
  process.stdout.write(go(4, 1) + green + "y = 削除 / その他 = キャンセル" + reset);
}

// ---------- 操作 ----------
async function loadNotes() {
  let db;
  try { db = openDb(); } catch (e) { console.error("DB 開けません:", e.message); process.exit(1); }
  notes = listNotes(db);
  db.db.close();
}

function setNote(n) { viewNote = n; inputBuf = n.content; idx = notes.findIndex((x) => x.id === n.id); }

// ---------- キー入力 ----------
function onKey(name, key) {
  if (key.ctrl && key.name === "c") { process.stdout.write(cls + show); process.exit(0); }

  if (mode === "list") {
    if (name === "up" && idx > 0) idx--;
    else if (name === "down" && idx < notes.length - 1) idx++;
    else if (name === "return") setNote(notes[idx]);
    else if (name === "+") { mode = "add"; inputBuf = ""; addingTitle = true; }
    else if (name === "d") { mode = "confirm"; confirmTarget = notes[idx]; }
    else if (name === "q") { process.stdout.write(cls + show); process.exit(0); }
  }
  else if (mode === "view") {
    if (name === "up") { if (scrollY > 0) scrollY--; }
    else if (name === "down") { const n = viewNote; if (n) { const L = wrap(n.content, process.stdout.columns || width).length; if (scrollY < L - 1) scrollY++; } }
    else if (name === "return") { mode = "edit"; inputBuf = viewNote.content; }
    else if (name === "d") { mode = "confirm"; confirmTarget = viewNote; }
    else if (name === "escape" || name === "left") { mode = "list"; scrollY = 0; }
  }
  else if (mode === "edit" || mode === "add") {
    if (name === "return") {
      if (mode === "add") { saveNew(); }
      else { saveEdit(); }
    } else if (name === "escape") { mode = viewNote ? "view" : "list"; }
    else if (name === "backspace") { inputBuf = inputBuf.slice(0, -1); }
    else if (key.sequence && key.sequence.length === 1) { inputBuf += key.sequence; }
  }
  else if (mode === "confirm") {
    if (name === "y") { removeNoteFn(); mode = "list"; confirmTarget = null; }
    else { mode = "list"; confirmTarget = null; }
  }
}

async function saveEdit() {
  if (!viewNote) return;
  try {
    const db = openDb();
    db.db.prepare(`UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ?`)
      .run(viewNote.title, inputBuf, Date.now().toString(), viewNote.id);
    db.db.close();
    viewNote.content = inputBuf;
    viewNote.updatedAt = Date.now().toString();
    mode = "view";
  } catch (e) { console.error("保存失敗:", e.message); process.exit(1); }
}

async function saveNew() {
  try {
    const db = openDb();
    addNote(db, inputBuf, Date.now().toString());
    db.db.close();
    notes = listNotes(openDb())[0] ? listNotes(openDb()) : [];
    db.db.close();
    mode = "list";
  } catch (e) { console.error("作成失敗:", e.message); process.exit(1); }
}

function removeNoteFn() {
  if (!confirmTarget) return;
  try {
    const db = openDb();
    removeNote(db, confirmTarget.id);
    db.db.close();
    notes = notes.filter((n) => n.id !== confirmTarget.id);
    if (idx >= notes.length) idx = Math.max(0, notes.length - 1);
  } catch (e) { console.error("削除失敗:", e.message); process.exit(1); }
}

// ---------- メイン ----------
async function main() {
  try { loadNotes(); } catch (e) { console.error("ロード失敗:", e.message); process.exit(1); }

  const rl = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.on("keypress", (str, key) => { onKey(key.name, key); render(); });
  rl.input.setRawMode(true);
  render();

  process.stdin.on("resize", render);
}

// avoid import warning
await import("./ura-db.js").catch(() => {});
main();