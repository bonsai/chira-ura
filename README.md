# chira-ura / チラ裏

書いたら自動保存。メモとコピーだけの軽量 Chrome 拡張。箱はローカル / GDrive / GitHub / Box から選ぶ。

旧名 `kami copi`（`kamicopi.net` と衝突するため改名）。

## スタック

- Chrome MV3 / Vanilla JS（フレームワーク無し）
- `chrome.storage.local`（ローカルはキャッシュ）
- `chrome.identity`（Google OAuth / GitHub・Box は Web Auth Flow）
- Google Drive + Apps Script（箱のマスター、拡張の外でデプロイ）
- Node CLI（`crx/scripts/cli.js`）

## 使い方

1. `bash tools/sync.sh` で `crx/` を Chrome の unpacked 読込先へコピー
2. `chrome://extensions` →「パッケージ化されていない拡張機能を読み込む」→ `.crx/chira-ura-crx` を指定
3. toolbar の popup から `書く` でサイドパネルを開いて書き、`コピー` / `取る` でクリップボードへ

```bash
chira client-id <id>.apps.googleusercontent.com   # manifest の oauth2.client_id
chira set gdrive.folderId <id>                    # 箱フォルダ
chira set auth.gh.clientId <id>                   # GitHub OAuth
chira box gdrive                                  # 既定の箱
chira path                                        # 鍵ファイル（平文 JSON・非秘密のみ）
```

トークンは保存しない。Google は `chrome.identity.getAuthToken`、GH/Box は `launchWebAuthFlow`（コード取得まで）。

## UI

- popup: 動詞コマンド7つ — 書く / 読む / コピー / 積む / 取る / 読み込む / 箱。下部に自動保存スイッチ、status（絵文字のみ）、最下部に gh → brand。
- 箱パネル: local / GDrive / GitHub / Box。選ぶと認証が走る。`鍵を読む` で keys.json を流し込む。
- サイドパネル: `index.html` = 書く / `log.html` = 過去記事を読む。
- コピーは内容のみ（前置き無し＝そのままプロンプトに流せる）。積みキューは LIFO・最大50。

## エージェント

- 編集は `crx/` のみ。`<LOAD>` はキャッシュなので直接編集しない。
- 反映は `bash tools/sync.sh` → 拡張の再読み込み。
- version は変更単位で細かく上げる（`version_name` に `-dev`）。
- 権限追加・設定 UI の復活は禁止。認証は OAuth のみ（トークンを平文に置かない）。
- 識別子（gh URL / OAuth client / 箱フォルダ / 箱名）は勝手に決めない。番号付き候補を出して選ばせる。

## 現在地

- v2.3.0-dev: 商標回避で `kami copi` → `chira-ura` に改名（repo / 鍵パス / Chrome 読込先も変更）。
- popup 動詞コマンド・箱選択・積みキュー・OAuth まで実装。
- 未確定: Google OAuth の `client_id`（`REPLACE_ME`）、GH/Box のトークン交換、箱への実際の保存。
- 未検証: Chrome 実機での再読み込み後の表示、`sidePanel.setOptions` で log.html が開くか。

## ログ

- 2026-10-19 v2.3.0-dev 改名（chira-ura）・dev.history.md 追加
- 2026-10-19 v2.2.0-dev OAuth 化（identity / auth.js / client-id）
- 2026-10-19 v2.1.0 箱(local/gdrive/gh/box)・積みキュー・動詞コマンド
- 2026-10-19 v2.0.0 popup 再構成 / skill 化 / sidepanel 分離

詳細は `dev.history.md`。
