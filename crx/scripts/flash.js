// chira-ura — 絵文字のみのステータス通知（popup / sidepanel 共用）
// テキストは title / aria-label に退避する。

export const MSG = {
  saving:   { e: "💾", t: "保存中" },
  saved:    { e: "📝", t: "ローカル保存済み" },
  copied:   { e: "📋", t: "クリップボード保存済み" },
  dirty:    { e: "✏️", t: "未保存" },
  imported: { e: "🗂", t: "読み込みました" },
  stacked:  { e: "🗃", t: "積みました" },
  popped:   { e: "📤", t: "取り出しました" },
  box:      { e: "📦", t: "箱を変更しました" },
  keyed:    { e: "🔑", t: "鍵を読み込みました" },
  gas:      { e: "⚠️", t: "CLI で GAS URL を設定してください" },
  empty:    { e: "✖️", t: "対象がありません" },
  fail:     { e: "🚫", t: "失敗しました" }
};

export function createFlasher(el) {
  let timer = null;
  return {
    flash(key) {
      const m = MSG[key];
      if (!m || !el) return;
      el.textContent = m.e;
      el.title = m.t;
      el.setAttribute("aria-label", m.t);
      el.classList.remove("flash");
      void el.offsetWidth; // アニメーション再開
      el.classList.add("flash");
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("flash"), 1400);
    },
    /** 任意の絵文字 + 説明（OAuth の成否など） */
    note(emoji, text) {
      if (!el) return;
      el.textContent = emoji;
      el.title = text || "";
      el.setAttribute("aria-label", text || "");
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("flash"), 1400);
    },
    idle(key) {
      if (!el) return;
      const m = key ? MSG[key] : null;
      el.textContent = m ? m.e : "";
      el.title = m ? m.t : "";
      el.classList.remove("flash");
    }
  };
}
