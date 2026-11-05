// chira-ura — storage-shim.js
// chrome.storage が無い環境でのみ、window.chrome.storage.local 互換を localStorage 裏で差し込む。
// 対象キー: notes, activeNoteId, autoSave（値の形式は既存のまま）
// onChanged: 同一ページ内の set で自前発火、他タブとは window.storage イベントで同期。
// 拡張環境（chrome.storage.local が存在）では実物が優先され何もしない。

(function () {
  const global = typeof window !== "undefined" ? window : globalThis;

  // 既に実物の chrome.storage.local がある場合は何もしない（実物が優先）
  if (global.chrome && global.chrome.storage && global.chrome.storage.local) {
    return;
  }

  global.chrome = global.chrome || {};
  global.chrome.storage = global.chrome.storage || {};

  const SHIM_KEYS = new Set(["notes", "activeNoteId", "autoSave"]);
  const listeners = new Set();

  function serialize(val) {
    return JSON.stringify(val);
  }

  function deserialize(raw) {
    if (raw === null || raw === undefined) return undefined;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return raw;
    }
  }

  function readKey(key) {
    const raw = global.localStorage.getItem(key);
    return deserialize(raw);
  }

  function writeKey(key, val) {
    if (val === undefined) {
      global.localStorage.removeItem(key);
    } else {
      global.localStorage.setItem(key, serialize(val));
    }
  }

  function dispatchChanges(changes) {
    if (!changes || Object.keys(changes).length === 0) return;
    for (const listener of Array.from(listeners)) {
      try {
        listener(changes, "local");
      } catch (err) {
        console.error("[storage-shim] listener error:", err);
      }
    }
  }

  const local = {
    get(keys, callback) {
      return new Promise((resolve) => {
        const result = {};

        if (keys === null || keys === undefined) {
          for (const key of SHIM_KEYS) {
            const val = readKey(key);
            if (val !== undefined) result[key] = val;
          }
        } else if (typeof keys === "string") {
          const val = readKey(keys);
          if (val !== undefined) result[keys] = val;
        } else if (Array.isArray(keys)) {
          for (const key of keys) {
            const val = readKey(key);
            if (val !== undefined) result[key] = val;
          }
        } else if (typeof keys === "object") {
          for (const [key, defaultVal] of Object.entries(keys)) {
            const val = readKey(key);
            result[key] = val !== undefined ? val : defaultVal;
          }
        }

        if (typeof callback === "function") callback(result);
        resolve(result);
      });
    },

    set(items, callback) {
      return new Promise((resolve) => {
        const changes = {};

        if (items && typeof items === "object") {
          for (const [key, nextVal] of Object.entries(items)) {
            const prevVal = readKey(key);
            writeKey(key, nextVal);
            changes[key] = {
              oldValue: prevVal,
              newValue: nextVal
            };
          }
        }

        dispatchChanges(changes);

        if (typeof callback === "function") callback();
        resolve();
      });
    },

    remove(keys, callback) {
      return new Promise((resolve) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const changes = {};

        for (const key of keyList) {
          const prevVal = readKey(key);
          if (prevVal !== undefined) {
            global.localStorage.removeItem(key);
            changes[key] = {
              oldValue: prevVal,
              newValue: undefined
            };
          }
        }

        dispatchChanges(changes);

        if (typeof callback === "function") callback();
        resolve();
      });
    },

    clear(callback) {
      return new Promise((resolve) => {
        const changes = {};
        for (const key of SHIM_KEYS) {
          const prevVal = readKey(key);
          if (prevVal !== undefined) {
            global.localStorage.removeItem(key);
            changes[key] = {
              oldValue: prevVal,
              newValue: undefined
            };
          }
        }

        dispatchChanges(changes);

        if (typeof callback === "function") callback();
        resolve();
      });
    }
  };

  const onChanged = {
    addListener(callback) {
      if (typeof callback === "function") {
        listeners.add(callback);
      }
    },
    removeListener(callback) {
      listeners.delete(callback);
    },
    hasListener(callback) {
      return listeners.has(callback);
    }
  };

  // 他タブとの同期（window.storage イベント）
  if (typeof global.addEventListener === "function") {
    global.addEventListener("storage", (e) => {
      if (!e.key) {
        // clear() が呼ばれた場合など
        const changes = {};
        for (const key of SHIM_KEYS) {
          changes[key] = {
            oldValue: undefined,
            newValue: readKey(key)
          };
        }
        dispatchChanges(changes);
        return;
      }

      if (SHIM_KEYS.has(e.key)) {
        const oldValue = deserialize(e.oldValue);
        const newValue = deserialize(e.newValue);
        dispatchChanges({
          [e.key]: {
            oldValue,
            newValue
          }
        });
      }
    });
  }

  global.chrome.storage.local = local;
  global.chrome.storage.onChanged = onChanged;
})();
