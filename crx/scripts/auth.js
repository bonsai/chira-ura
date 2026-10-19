// kami copi — 認証（OAuth 優先）
// トークンは保存しない。Google は chrome.identity.getAuthToken のキャッシュに任せる。
// GitHub / Box は launchWebAuthFlow でコード取得まで（トークン交換はサーバ側 = GAS 等が担う）。

const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

export function googleClientId() {
  return chrome.runtime.getManifest()?.oauth2?.client_id || "";
}

function hasPlaceholderClientId() {
  const id = googleClientId();
  return !id || id.startsWith("REPLACE_ME");
}

/** Google のアクセストークン（interactive=true で同意画面を出す） */
export async function googleToken(interactive = true) {
  if (hasPlaceholderClientId()) {
    throw new Error("manifest.json の oauth2.client_id が未設定（CLI: kami set oauth.client_id）");
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes: GOOGLE_SCOPES }, (token) => {
      const err = chrome.runtime.lastError;
      if (err || !token) return reject(new Error(err?.message || "トークン取得に失敗"));
      resolve(token);
    });
  });
}

/** キャッシュ済みトークンを捨てる（失効・切り替え用） */
export async function googleSignOut() {
  let token = null;
  try { token = await googleToken(false); } catch (_) { return; }
  await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
}

/** サインイン中の Google アカウント（identity.email 権限がある場合のみ） */
export function googleAccount() {
  try {
    const info = chrome.identity.getProfileUserInfo({ accountStatus: "ANY" });
    return info?.email || "";
  } catch (_) {
    return "";
  }
}

/** GitHub / Box: client_id は chrome.storage の keys から。コード取得まで。 */
export async function webAuthCode(provider, clientId, authUrl, scope) {
  if (!clientId) throw new Error(`${provider}: client_id 未設定`);
  const redirectUri = chrome.identity.getRedirectURL("kami");
  const url = new URL(authUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scope);
  if (provider === "gh") url.searchParams.set("state", crypto.randomUUID());

  const res = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true }, (r) => {
      const err = chrome.runtime.lastError;
      if (err || !r) return reject(new Error(err?.message || `${provider}: 認可失敗`));
      resolve(r);
    });
  });

  const back = new URL(res);
  const code = back.searchParams.get("code");
  if (!code) throw new Error(`${provider}: コードが返らない`);
  return { code, redirectUri };
}
