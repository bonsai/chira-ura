// kami copi v2 — sidepanel: 過去記事を読む（読み専用）
import { copy } from "../scripts/clipboard.js";
import { createFlasher } from "../scripts/flash.js";

const NOTES_KEY = "notes";
const GAS_URL_KEY = "gasUrl";

const GH_URL = "https://github.com/bonsai/kami-copi";

const els = {
  status: document.getElementById("status"),
  noteList: document.getElementById("noteList"),
  jsonlFile: document.getElementById("jsonlFile"),
  btnGDrive: document.getElementById("btnGDrive"),
  linkGh: document.getElementById("linkGh")
};

const flasher = createFlasher(els.status);

let notes = [];
let openId = null;

// ---------- 初期化 ----------
async function init() {
  const res = await chrome.storage.local.get([NOTES_KEY, GAS_URL_KEY]);
  notes = res[NOTES_KEY] || [];
  const gasUrl = res[GAS_URL_KEY] || "";

  if (gasUrl) {
    els.btnGDrive.href = gasUrl;
    els.btnGDrive.hidden = false;
  }
  if (GH_URL) {
    els.linkGh.href = GH_URL;
    els.linkGh.hidden = false;
  }
  render();
}

// ---------- 表示 ----------
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString("ja-JP", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function render() {
  els.noteList.innerHTML = "";
  if (notes.length === 0) {
    els.noteList.innerHTML = '<div class="empty-list">まだ記事がありません</div>';
    return;
  }

  const sorted = [...notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  sorted.forEach(n => {
    const open = n.id === openId;
    const card = document.createElement("article");
    card.className = "memo-card" + (open ? " open" : "");
    const preview = (n.content || "").replace(/\n/g, " ").slice(0, 60);

    card.innerHTML = `
      <header class="memo-head">
        <span class="memo-title">${escapeHtml(n.title || "無題")}</span>
        <time class="memo-date">${formatDate(n.updatedAt || Date.now())}</time>
      </header>
      ${open
        ? `<pre class="memo-body">${escapeHtml(n.content || "")}</pre>`
        : `<div class="memo-preview">${escapeHtml(preview)}</div>`}
      <div class="memo-actions">
        <button class="btn mini copy" data-id="${n.id}">コピー</button>
      </div>
    `;

    card.querySelector(".copy").addEventListener("click", (e) => {
      e.stopPropagation();
      copyMemo(n.id);
    });
    card.querySelector(".memo-head").addEventListener("click", () => {
      openId = open ? null : n.id;
      render();
    });

    els.noteList.appendChild(card);
  });
}

async function copyMemo(id) {
  const n = notes.find(x => x.id === id);
  if (!n || !(n.content || "").trim()) {
    flasher.flash("empty");
    return;
  }
  try {
    // 前置きを付けない＝そのままプロンプトに流せる
    await copy(n.content);
    flasher.flash("copied");
  } catch (_) {
    flasher.flash("fail");
  }
}

// ---------- JSONL 読み込み ----------
els.jsonlFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split("\n").filter(l => l.trim());
  let imported = 0;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.content === undefined) continue;
      notes.unshift({
        id: obj.id || "note-" + Date.now() + "-" + imported,
        title: obj.title || "無題",
        content: obj.content,
        updatedAt: obj.updatedAt || Date.now()
      });
      imported++;
    } catch (_) { /* 壊れた行は捨てる */ }
  }

  if (imported > 0) {
    await chrome.storage.local.set({ [NOTES_KEY]: notes });
    flasher.flash("imported");
    render();
  } else {
    flasher.flash("empty");
  }
  e.target.value = "";
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[NOTES_KEY]) {
    notes = changes[NOTES_KEY].newValue || [];
    render();
  }
  if (changes[GAS_URL_KEY]) {
    const url = changes[GAS_URL_KEY].newValue || "";
    if (url) {
      els.btnGDrive.href = url;
      els.btnGDrive.hidden = false;
    } else {
      els.btnGDrive.hidden = true;
    }
  }
});

init();
