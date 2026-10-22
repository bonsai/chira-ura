#!/usr/bin/env node
// chira-ura TUI — ターミナル UI でメモを閲覧・編集
// 保存先: dev/presets.json から選択可能

import { openDb, listNotes, addNote, removeNote, DB_PATH } from "./ura-db.js";
import { join, dirname, resolve } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

// ---------- 端末サイズ ----------
let W = process.stdout.columns || 80;
let H = process.stdout.rows || 24;

// ---------- ANSI ----------
const esc = (c) => `\x1b[${c}m`;
const cls = "\x1b[2J\x1b[H";
const hide = "\x1b[?25l";
const show = "\x1b[?25h";
const clearLine = "\x1b[2K";
const go = (r, c) => `\x1b[${r};${c}H`;
const bold = esc("1");
const dim = esc("2");
const rev = esc("7");
const cyan = esc("36");
const green = esc("32");
const red = esc("31");
const reset = esc("0");

// ---------- Preset ----------
const PRESETS_PATH = resolve(REPO_ROOT, "dev", "presets.json");
let PRESETS = [];
try { PRESETS = JSON.parse(readFileSync(PRESETS_PATH, "utf8")); } catch {
  PRESETS = [
    { name: "repo-data", path: resolve(REPO_ROOT, "data") },
    { name: "dist-crx", path: resolve(REPO_ROOT, "dist", "chira-ura-crx") },
  ];
}

// ---------- state ----------
let mode = "select";          // select | list | view | edit | add | confirm
let notes = [];
let idx = 0;
let inputBuf = "";
let scrollY = 0;
let selectedPreset = 0;
let dbObj = null;
let dbPath = null;
let viewNote = null;
let confirmTarget = null;

// ---------- helpers ----------
function wrap(text, w) {
  const lines = [];
  for (const p of String(text).split("\n")) {
    if (!p) { lines.push(""); continue; }
    let t = p;
    while (t.length > w) { lines.push(t.slice(0, w)); t = t.slice(w); }
    lines.push(t);
  }
  return lines;
}

function closeDb() {
  if (dbObj) { try { dbObj.db.close(); } catch {} dbObj = null; }
}

function resolvePath(p) {
  if (!p) return p;
  return p.replace(/^\\+/, "").replace(/^\\\\wsl\.localhost/, process.cwd()); // placeholder normalize
}

async function selectPreset() {
  dbPath = PRESETS[selectedPreset].path;
  process.env.CHIRA_DB = dbPath;
  await refresh();
}

async function refresh() {
  closeDb();
  dbObj = openDb();
  notes = listNotes(dbObj.db);
  dbObj.db.close();
  dbObj = null;
  mode = "list";
}

// ---------- render ----------
function render() {
  W = process.stdout.columns || W;
  H = process.stdout.rows || H;
  const cols = W, rows = Math.max(6, H);
  process.stdout.write(cls + hide);

  const title = ` chira-ura TUI `;
  const head = `${bold}${cyan}${title}${reset}${dim} mode:${mode} db:${dbPath} notes:${notes.length} ${reset}`;
  process.stdout.write(go(1, 1) + head.padEnd(cols).slice(0, cols) + "\n");

  if (mode === "select") {
    process.stdout.write(go(3, 1) + dim + "保存先を選択:" + reset + "\n");
    for (let i = 0; i < Math.min(PRESETS.length, rows - 5); i++) {
      const p = PRESETS[i];
      const m = i === selectedPreset ? `${rev} ${p.name}: ${p.path} ${reset}` : `  ${p.name}: ${p.path}`;
      process.stdout.write(go(4 + i, 1) + clearLine + m.slice(0, cols - 2) + "\n");
    }
  }
  else if (mode === "list") {
    if (notes.length === 0) {
      process.stdout.write(go(3, 1) + dim + "メモがありません。+ で追加 / s で保存先選択" + reset);
    } else {
      const start = Math.max(0, idx - Math.floor((rows - 7) / 2));
      const end = Math.min(notes.length, start + (rows - 7));
      for (let i = start; i < end; i++) {
        const n = notes[i];
        const m = i === idx ? `${rev} ${n.title} ${reset}` : `  ${n.title}`;
        process.stdout.write(go(3 + (i - start), 1) + clearLine + m.slice(0, cols - 2) + "\n");
      }
    }
  }
  else if (mode === "view" && viewNote) {
    const n = viewNote;
    process.stdout.write(go(3, 1) + bold + n.title + reset + "\n");
    process.stdout.write(go(4, 1) + dim + new Date(Number(n.updatedAt)).toLocaleString() + reset + "\n\n");
    const lines = wrap(n.content, cols - 2);
    const dh = rows - 8;
    for (let i = 0; i < dh; i++) {
      const li = scrollY + i;
      if (li >= lines.length) break;
      process.stdout.write(go(6 + i, 1) + clearLine + lines[li].slice(0, cols - 2) + "\n");
    }
  }
  else if (mode === "edit" || mode === "add") {
    const label = mode === "add" ? "新規タイトル: " : "本文: ";
    process.stdout.write(go(3, 1) + bold + label + reset);
    const lines = wrap(inputBuf, cols - 4);
    const eh = Math.max(4, rows - 9);
    const sL = Math.max(0, lines.length - eh);
    for (let i = sL; i < lines.length; i++) {
      process.stdout.write(go(4 + (i - sL), 1) + clearLine + lines[i].slice(0, cols - 4) + "\n");
    }
  }
  else if (mode === "confirm" && confirmTarget) {
    process.stdout.write(go(3, 1) + red + `削除します: ${confirmTarget.title}？` + reset + "\n");
    process.stdout.write(go(4, 1) + green + "y=削除 / その他=キャンセル" + reset);
  }

  const help = mode === "select"
    ? `${green}↑↓${reset}選択 ${green}Enter${reset}決定 ${green}q${reset}終了`
    : `${green}↑↓${reset}移動 ${green}Enter${reset}開く ${green}+${reset}追加 ${green}d${reset}削除 ${green}s${reset}保存先 ${green}q${reset}終了`;
  process.stdout.write(go(rows, 1) + dim + help.padEnd(cols).slice(0, cols) + reset);
  process.stdout.write(show);
}

// ---------- input ----------
function onKey(name, key) {
  if (key.ctrl && key.name === "c") { process.stdout.write(cls + show); process.exit(0); }

  if (mode === "select") {
    if (name === "up" && selectedPreset > 0) selectedPreset--;
    else if (name === "down" && selectedPreset < PRESETS.length - 1) selectedPreset++;
    else if (name === "return") selectPreset();
    else if (name === "q") { process.stdout.write(cls + show); process.exit(0); }
  }
  else if (mode === "list") {
    if (name === "up" && idx > 0) idx--;
    else if (name === "down" && idx < notes.length - 1) idx++;
    else if (name === "return" && notes[idx]) { viewNote = notes[idx]; inputBuf = viewNote.content; scrollY = 0; mode = "view"; }
    else if (name === "+") { inputBuf = notes.length ? (notes[idx]?.title || "") : ""; mode = "add"; }
    else if (name === "d" && notes[idx]) { confirmTarget = notes[idx]; mode = "confirm"; }
    else if (name === "s") { mode = "select"; }
    else if (name === "q") { process.stdout.write(cls + show); process.exit(0); }
  }
  else if (mode === "view") {
    if (name === "up" && scrollY > 0) scrollY--;
    else if (name === "down") { const L = wrap(viewNote.content, W).length; if (scrollY < L - 1) scrollY++; }
    else if (name === "return") { inputBuf = viewNote.content; mode = "edit"; }
    else if (name === "d") { confirmTarget = viewNote; mode = "confirm"; }
    else if (name === "escape") { mode = "list"; scrollY = 0; }
  }
  else if (mode === "edit") {
    if (name === "return") { saveEdit(); }
    else if (name === "escape") { mode = "view"; }
    else if (name === "backspace") inputBuf = inputBuf.slice(0, -1);
    else if (key.sequence && key.sequence.length === 1) inputBuf += key.sequence;
  }
  else if (mode === "add") {
    if (name === "return") { saveNew(); }
    else if (name === "escape") { mode = "list"; }
    else if (name === "backspace") inputBuf = inputBuf.slice(0, -1);
    else if (key.sequence && key.sequence.length === 1) inputBuf += key.sequence;
  }
  else if (mode === "confirm") {
    if (name === "y") { removeNoteFn(); mode = "list"; }
    else { mode = "list"; }
    confirmTarget = null;
  }
}

// ---------- actions ----------
async function saveEdit() {
  if (!viewNote) { mode = "list"; return; }
  const d = openDb();
  d.db.prepare("UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ?")
    .run(viewNote.title, inputBuf, Date.now().toString(), viewNote.id);
  d.db.close();
  viewNote.content = inputBuf; viewNote.updatedAt = Date.now().toString();
  mode = "view";
  await refresh();
}

async function saveNew() {
  const d = openDb();
  addNote(d.db, inputBuf, Date.now().toString());
  d.db.close();
  await refresh();
  inputBuf = "";
}

function removeNoteFn() {
  const d = openDb();
  removeNote(d.db, confirmTarget.id);
  d.db.close();
  refresh();
}

// ---------- main ----------
async function main() {
  // preset デフォルト選択 (env 優先)
  const env = process.env.CHIRA_DB || process.env.CHIRA_LOAD_DIR;
  if (env) {
    const hit = PRESETS.findIndex((p) => p.path === env) ?? 0;
    selectedPreset = hit >= 0 ? hit : 0;
    dbPath = env;
  }
  dbPath = dbPath || PRESETS[0].path;
  try { await refresh(); } catch (e) { console.error("DB:", e.message); notes = []; }

  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (process.stdin.setRawMode) process.stdin.setRawMode(true);
  rl.on("keypress", (_ch, key) => { onKey(key.name, key); render(); });
  process.stdin.on("resize", render);
  render();
}

main().catch((e) => { console.error(e); process.stdout.write(cls + show); process.exit(1); });