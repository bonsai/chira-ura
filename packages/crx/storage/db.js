// chira-ura v2 — storage (minimal)
// ローカルはキャッシュ。箱・設定はCLI、GAS/GDriveがマスター。

const KEYS = {
  NOTE: "note",
  DEFAULT_BOX: "defaultBox",
  GAS_URL: "gasUrl"
};

const db = {
  async get() {
    return chrome.storage.local.get([KEYS.NOTE, KEYS.DEFAULT_BOX, KEYS.GAS_URL]);
  },

  async set(note) {
    await chrome.storage.local.set({ [KEYS.NOTE]: note });
  },

  async getNote() {
    const res = await this.get();
    return res[KEYS.NOTE] ?? "";
  },

  async setGasUrl(url) {
    await chrome.storage.local.set({ [KEYS.GAS_URL]: url });
  },

  async getGasUrl() {
    const res = await this.get();
    return res[KEYS.GAS_URL] ?? "";
  },

  async setDefaultBox(name) {
    await chrome.storage.local.set({ [KEYS.DEFAULT_BOX]: name });
  },

  async getDefaultBox() {
    const res = await this.get();
    return res[KEYS.DEFAULT_BOX] ?? "ふだ / 短冊";
  }
};

export default db;
