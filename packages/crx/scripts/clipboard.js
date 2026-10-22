// chira-ura — clipboard utility (ES module)
// Chrome拡張（MV3）のサイドパネル／ポップアップで使うクリップボード操作。
// navigator.clipboard が使えない環境へのフォールバック付き。

/**
 * テキストをクリップボードにコピーする
 * @param {string} text - コピーする文字列
 * @returns {Promise<void>}
 * @throws {Error} コピーに失敗した場合
 */
export async function copy(text) {
  if (typeof text !== "string") {
    throw new Error("copy() の引数は文字列である必要があります");
  }

  // 1) 標準的な Clipboard API（拡張ページは安全なコンテキストなので利用可能）
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // 2) フォールバック：一時textareaを作成して execCommand('copy')
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";
  textarea.setAttribute("readonly", "");
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const ok = document.execCommand("copy");
    if (!ok) {
      throw new Error("execCommand('copy') が失敗しました");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * クリップボードAPIが利用可能か
 * @returns {boolean}
 */
export function isSupported() {
  return !!(navigator.clipboard && navigator.clipboard.writeText);
}
