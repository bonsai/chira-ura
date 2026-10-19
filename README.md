# chira-ura / チラ裏

書いたら自動保存。メモとコピーだけの軽量 Chrome 拡張。箱はローカル / GDrive / GitHub / Box から選ぶ。

旧名 `kami copi`（`kamicopi.net` と衝突するため改名）。

構成: `crx/`（拡張）/ `cli/`（設定・同期クライアント）/ `dev/`（履歴・UI/UX 仕様）。

## スタック

- Chrome MV3 / Vanilla JS（フレームワーク無し）
- `chrome.storage.local`（ローカルはキャッシュ）
- `chrome.identity`（Google OAuth / GitHub・Box は Web Auth Flow）
- Google Drive + Apps Script（箱のマスター、拡張の外でデプロイ）
- Node CLI（`cli/cli.js`、bin: `chira`）

## 使い方

1. `bash cli/sync.sh` で `crx/` を Chrome の unpacked 読込先へコピー
2. `chrome://extensions` →「パッケージ化されていない拡張機能を読み込む」→ `.crx/chira-ura-crx` を指定
3. popup の `書く` でサイドパネルを開いて書き、`コピー` でクリップボードへ

```bash
chira client-id <id>.apps.googleusercontent.com   # manifest の oauth2.client_id
chira set gdrive.folderId <id>                    # 箱フォルダ
chira set auth.gh.clientId <id>                   # GitHub OAuth
chira box gdrive                                  # 既定の箱
chira path                                        # 鍵ファイル（平文 JSON・非秘密のみ）
chira serve                                       # ブリッジ（拡張が 5 分毎に pull）
chira pull | push | sync                          # 同期の意味は「GDrive が正」
```

トークンは保存しない。Google は `chrome.identity.getAuthToken`、GH/Box は `launchWebAuthFlow`（コード取得まで）。

## UI

- popup: 動詞5つ — 書く / 読む / 箱 / イシュー / 履歴。下部に自動保存スイッチと status（絵文字のみ）、最下部に brand。
- 箱パネル: local / GDrive / GitHub / Box、フォルダ（folder ID/URL）、ファイル（JSONL 読込）、鍵（keys.json）。
- サイドパネル: `write.html` = 書く / `read.html` = 過去記事を読む。
- コピーは本文のみ（前置き無し＝そのままプロンプトに流せる）。

## エージェント

- 編集は `crx/` と `cli/` のみ。`/mnt/c/Users/dance/.crx/chira-ura-crx` はキャッシュなので直接編集しない。
- 反映は `bash cli/sync.sh` → 拡張の再読み込み。
- version は変更単位で細かく上げる（`version_name` に `-dev`）。変更は `dev/dev.history.md` に追記。
- 権限追加・設定 UI の復活は禁止。認証は OAuth のみ（トークンを平文に置かない）。
- 識別子（gh URL / OAuth client / 箱フォルダ / 箱名）は勝手に決めない。番号付き候補を出して選ばせる。

## 現在地

- v2.5.3-dev: repo を `dev/ crx/ cli/` 構成に（`dev/` は旧 `doc/`）。
- popup は 5 コマンド。コピー・積む・取るは削除、読込は箱へ統合、gh はイシュー/履歴へ統合。
- 未確定: Google OAuth の `client_id`（`REPLACE_ME`）、GH/Box のトークン交換、箱への実際の保存。
- 未検証: Chrome 実機での再読み込み後の表示、`sidePanel.setOptions` で read.html が開くか。

## ログ

- 2026-10-19 v2.5.3-dev `doc/` → `dev/`
- 2026-10-19 v2.5.2-dev `doc crx cli` 構成
- 2026-10-19 v2.5.1-dev sidepanel を write/read に改名
- 2026-10-19 v2.5.0-dev popup 5 コマンド化（コピー/積む/取る削除、読込は箱、gh はイシュー/履歴）
- 2026-10-19 v2.4.0-dev localhost ブリッジ（GDrive が正）
- 2026-10-19 v2.3.0-dev 商標回避で chira-ura に改名
- 2026-10-19 v2.2.0-dev OAuth 化
- 2026-10-19 v2.1.0 箱・積みキュー・動詞コマンド
- 2026-10-19 v2.0.0 popup 再構成 / skill 化 / sidepanel 分離

詳細は `dev/dev.history.md`。
