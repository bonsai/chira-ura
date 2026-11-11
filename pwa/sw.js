// chira-ura PWA — Service Worker
// キャッシュ名: バージョン付き
const CACHE_NAME = "chira-ura-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./style.css",
  "./app.js",
  "./model.js",
  "../crx/scripts/model.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable.png",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
  "./icons/icon-maskable.svg"
];

// インストール: アプリシェルを事前キャッシュ
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

// アクティベート: 古いキャッシュの削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// フェッチ: キャッシュ優先、フォールバックでネットワーク（更新もキャッシュへ反映）
self.addEventListener("fetch", (event) => {
  // 非 GET リクエストはキャッシュ対象外
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // 同一オリジンまたはローカル・GitHub Pages の相対リソース
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // バックグラウンドで更新確認（Stale-while-revalidate 的な動き）
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
        }).catch(() => {
          // オフライン時は無視
        });
        return cachedResponse;
      }

      // キャッシュにない場合はネットワークから取得し、キャッシュに追加
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // オフライン時のナビゲーション要求なら index.html を返す
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});
