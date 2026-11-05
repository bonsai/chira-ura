import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shimSource = readFileSync(resolve(__dirname, "../crx/scripts/storage-shim.js"), "utf8");

function createMockEnvironment({ existingChrome = false } = {}) {
  const store = new Map();
  const storageListeners = [];

  const localStorage = {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      const oldVal = store.has(k) ? store.get(k) : null;
      store.set(k, String(v));
      // StorageEvent 発火
      for (const listener of storageListeners) {
        listener({
          key: k,
          oldValue: oldVal,
          newValue: String(v)
        });
      }
    },
    removeItem(k) {
      const oldVal = store.has(k) ? store.get(k) : null;
      store.delete(k);
      for (const listener of storageListeners) {
        listener({
          key: k,
          oldValue: oldVal,
          newValue: null
        });
      }
    },
    clear() {
      store.clear();
      for (const listener of storageListeners) {
        listener({
          key: null,
          oldValue: null,
          newValue: null
        });
      }
    }
  };

  const context = {
    localStorage,
    addEventListener(type, listener) {
      if (type === "storage") {
        storageListeners.push(listener);
      }
    },
    console
  };

  if (existingChrome) {
    context.chrome = {
      storage: {
        local: {
          isReal: true,
          get: async () => ({ isReal: true })
        }
      }
    };
  }

  context.window = context;
  context.globalThis = context;

  vm.createContext(context);
  return { context, store, storageListeners };
}

test("storage-shim: Chrome拡張環境（実物がある場合）は何もしない", () => {
  const { context } = createMockEnvironment({ existingChrome: true });
  vm.runInContext(shimSource, context);
  assert.equal(context.chrome.storage.local.isReal, true);
});

test("storage-shim: get / set と同一ページ内の onChanged 自前発火", async () => {
  const { context } = createMockEnvironment();
  vm.runInContext(shimSource, context);

  assert.ok(context.chrome.storage.local);
  assert.ok(context.chrome.storage.onChanged);

  let firedChanges = null;
  let firedArea = null;
  const listener = (changes, area) => {
    firedChanges = changes;
    firedArea = area;
  };

  context.chrome.storage.onChanged.addListener(listener);
  assert.equal(context.chrome.storage.onChanged.hasListener(listener), true);

  // set
  await context.chrome.storage.local.set({
    notes: [{ id: "n1", title: "テスト", content: "テスト本文", updatedAt: 12345 }],
    activeNoteId: "n1",
    autoSave: false
  });

  assert.equal(firedArea, "local");
  assert.deepEqual(firedChanges.notes.newValue, [
    { id: "n1", title: "テスト", content: "テスト本文", updatedAt: 12345 }
  ]);
  assert.equal(firedChanges.notes.oldValue, undefined);
  assert.equal(firedChanges.activeNoteId.newValue, "n1");
  assert.equal(firedChanges.autoSave.newValue, false);

  // get with string
  const resStr = await context.chrome.storage.local.get("activeNoteId");
  assert.equal(resStr.activeNoteId, "n1");

  // get with array
  const resArr = await context.chrome.storage.local.get(["notes", "autoSave"]);
  assert.equal(resArr.notes.length, 1);
  assert.equal(resArr.autoSave, false);

  // get with object (defaults)
  const resObj = await context.chrome.storage.local.get({
    activeNoteId: "defaultId",
    unknownKey: "defaultVal"
  });
  assert.equal(resObj.activeNoteId, "n1");
  assert.equal(resObj.unknownKey, "defaultVal");

  // get all (null)
  const resAll = await context.chrome.storage.local.get(null);
  assert.equal(resAll.activeNoteId, "n1");
  assert.equal(resAll.autoSave, false);
  assert.equal(resAll.notes.length, 1);

  // removeListener
  context.chrome.storage.onChanged.removeListener(listener);
  assert.equal(context.chrome.storage.onChanged.hasListener(listener), false);
});

test("storage-shim: window storage イベント（他タブ同期）で onChanged が発火する", async () => {
  const { context, storageListeners } = createMockEnvironment();
  vm.runInContext(shimSource, context);

  let firedChanges = null;
  let firedArea = null;
  context.chrome.storage.onChanged.addListener((changes, area) => {
    firedChanges = changes;
    firedArea = area;
  });

  // 他タブからの storage イベントをシミュレート
  for (const l of storageListeners) {
    l({
      key: "notes",
      oldValue: JSON.stringify([{ id: "old", content: "old" }]),
      newValue: JSON.stringify([{ id: "new", content: "new" }])
    });
  }

  assert.equal(firedArea, "local");
  assert.deepEqual(JSON.parse(JSON.stringify(firedChanges.notes.oldValue)), [{ id: "old", content: "old" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(firedChanges.notes.newValue)), [{ id: "new", content: "new" }]);
});
