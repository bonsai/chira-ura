# kami-copi / 紙コピー

書いたら自動保存。メモ入力とコピーだけの超軽量 Chrome 拡張。箱は GDrive(GAS) がマスター。

## スタック

- Chrome MV3 / Vanilla JS（フレームワーク無し）
- `chrome.storage.local`（ローカルはキャッシュ）
- Google Drive + Apps Script（マスター、拡張の外でデプロイ）
- Node CLI（`extension/scripts/cli.js`）

## 使い方

1. `bash tools/sync.sh` で `crx/` を Chrome の unpacked 読込先へコピー
2. `chrome://extensions` →「パッケージ化されていない拡張機能を読み込む」→ `.crx/kami-copi-crx` を指定
3. toolbar の popup に書く → 自動保存 → `コピー` でクリップボードへ

```bash
kami client-id <id>.apps.googleusercontent.com   # manifest の oauth2.client_id
kami set gdrive.folderId <id>                    # 箱フォルダ
kami set auth.gh.clientId <id>                   # GitHub OAuth
kami box gdrive                                  # 既定の箱
kami path                                        # 鍵ファイル（平文 JSON・非秘密のみ）
```

トークンは保存しない。Google は `chrome.identity.getAuthToken`、GH/Box は `launchWebAuthFlow`（コード取得まで）。

## UI 決定（user.review.json / ultra_minimal）

- popup: コマンド一覧のみ（最大7行）— 書く / 過去記事 / コピー / 自動保存 / クラウド / CLI / 箱。最下部 brand、その上 gh
- sidepanel: `index.html` = 書く / `log.html` = 過去記事を読む（展閖・コピー・JSONL 読込・箱）
- ステータスは下部・絵文字のみ・ブリンク（📝 ローカル保存済み / 📋 コピー済み / 🗂 読込）
- brand と gh は popup 最下部のみ（sidepanel には置かない）
- コピーは内容のみ（前置き無し＝そのままプロンプトに流せる）
- 設定画面・テーマ選択・複数箱リストは戻さない

## エージェント

- 編集は `crx/` のみ。version は変更単位で細かく上げる（`version_name` に `-dev` を付ける）。`/mnt/c/Users/dance/.crx/kami-copi-crx` はキャッシュなので直接編集しない。
- 反映は `bash tools/sync.sh` → 拡張の再読み込み。ファイル監視はしない。
- 権限追加・設定 UI の復活は禁止（`storage`, `sidePanel` のみ）。
- 識別子（gh URL / GAS URL / 箱名）は勝手に決めない。番号付き候補を出して選ばせる。

## 現在地

- v2.2.0-dev: popup を動詞コマンド7つ（書く/読む/コピー/積む/取る/読み込む/箱）+ 箱パネル + 自動保存スイッチに。クリップボードのスタックキュー実装。OAuth 化（client_id 未発行）。

- popup v2 再構成 完了: コマンド一覧のみ（書く/過去記事/コピー/自動保存/クラウド/CLI/箱）、最下部に brand・その上に gh、status は下部絵文字ブリンク。
- sidepanel 2 ページ化 完了: `index.html`（書く）/ `log.html`（過去記事を読む）。相互リンク、JSONL 読込は log 側。
- 未確定: GAS 同期（`scripts/cli.js` は stub）。
- 未着手: popup と sidepanel の保存キー統一（`note` vs `notes`）。
- 未検証: Chrome 実機での再読み込み後の表示確認、`chrome.sidePanel.setOptions` で log.html が開くか。

## ログ

- 2026-10-19 popup を「書く＋コピる＋設定集約」に再構成、skill repo 化
- 2026-10-19 sidepanel を書く（index.html）/ 過去記事を読む（log.html）に分離、status を絵文字ブリンクに統一
- 2026-10-19 popup をコマンド一覧（最大7・brand/gh は最下部）に変更、sidepanel から brand/gh 撤去、`extension/` → `crx/`
- 2026-10-19 v2.1.0: 箱選択(local/gdrive/gh/box)、箱・読込を popup へ移設、stack キュー、CLI 平文 key
- 2026-10-19 v2.2.0-dev: OAuth 化（identity.permissions、auth.js、client-id コマンド）
