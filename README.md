# kami-copi / 紙コピー

書いたら自動保存。メモ入力とコピーだけの超軽量 Chrome 拡張。箱は GDrive(GAS) がマスター。

## スタック

- Chrome MV3 / Vanilla JS（フレームワーク無し）
- `chrome.storage.local`（ローカルはキャッシュ）
- Google Drive + Apps Script（マスター、拡張の外でデプロイ）
- Node CLI（`extension/scripts/cli.js`）

## 使い方

1. `bash tools/sync.sh` で `extension/` を Chrome の unpacked 読込先へコピー
2. `chrome://extensions` →「パッケージ化されていない拡張機能を読み込む」→ `.crx/kami-copi-crx` を指定
3. toolbar の popup に書く → 自動保存 → `コピー` でクリップボードへ

```bash
kami set gas-url <URL>
kami set default-box <名>
kami sync pull | push
```

## UI 決定（user.review.json / ultra_minimal）

- popup: 入力エリア + コピー + `設定`(toggle 集約) + `CLI`(案内) + `過去記事`
- sidepanel: `index.html` = 書く / `log.html` = 過去記事を読む（展閖・コピー・JSONL 読込・箱）
- ステータスは下部・絵文字のみ・ブリンク（📝 ローカル保存済み / 📋 コピー済み / 🗂 読込）
- ブランドはフッターのみ、フッターの外部リンクは gh だけ
- コピーは内容のみ（前置き無し＝そのままプロンプトに流せる）
- 設定画面・テーマ選択・複数箱リストは戻さない

## エージェント

- 編集は `extension/` のみ。`<LOAD>/.crx/kami-copi-crx` はキャッシュなので直接編集しない。
- 反映は `bash tools/sync.sh` → 拡張の再読み込み。ファイル監視はしない。
- 権限追加・設定 UI の復活は禁止（`storage`, `sidePanel` のみ）。
- 識別子（gh URL / GAS URL / 箱名）は勝手に決めない。番号付き候補を出して選ばせる。

## 現在地

- popup v2 再構成 完了: toggle 集約（sidepanel から撤去）、CLI 案内、過去記事ボタン（log.html へ切替）、下部 status（絵文字ブリンク）、フッターにブランド + gh 枠。
- sidepanel 2 ページ化 完了: `index.html`（書く）/ `log.html`（過去記事を読む）。相互リンク、JSONL 読込は log 側。
- 未確定: GAS 同期（`scripts/cli.js` は stub）。
- 未着手: popup と sidepanel の保存キー統一（`note` vs `notes`）。
- 未検証: Chrome 実機での再読み込み後の表示確認、`chrome.sidePanel.setOptions` で log.html が開くか。

## ログ

- 2026-10-19 popup を「書く＋コピる＋設定集約」に再構成、skill repo 化
- 2026-10-19 sidepanel を書く（index.html）/ 過去記事を読む（log.html）に分離、status を絵文字ブリンクに統一
