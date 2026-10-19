// kami copi — クリップボードのスタックキュー
// chrome.storage.local に { text, at } の配列で持つ（先頭が最新）。

export const STACK_KEY = "clipStack";
export const STACK_MAX = 50;

export async function getStack() {
  const res = await chrome.storage.local.get([STACK_KEY]);
  return Array.isArray(res[STACK_KEY]) ? res[STACK_KEY] : [];
}

export async function stackDepth() {
  return (await getStack()).length;
}

/** 積む。直前と同じ内容なら重複させない。戻り値は積んだ後の深さ。 */
export async function pushStack(text) {
  const t = (text || "").trim();
  const stack = await getStack();
  if (!t) return stack.length;
  if (stack[0]?.text === t) return stack.length;

  const next = [{ text: t, at: Date.now() }, ...stack].slice(0, STACK_MAX);
  await chrome.storage.local.set({ [STACK_KEY]: next });
  return next.length;
}

/** 取る（LIFO）。空なら null。 */
export async function popStack() {
  const stack = await getStack();
  if (stack.length === 0) return null;
  const [top, ...rest] = stack;
  await chrome.storage.local.set({ [STACK_KEY]: rest });
  return top;
}

export async function clearStack() {
  await chrome.storage.local.set({ [STACK_KEY]: [] });
}
