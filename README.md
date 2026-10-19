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
- ステータスは下部・絵文字のみ・ブリンク（📝 ローカル保存済み / 📋 コピー済み）
- ブランドはフッターのみ、フッターのリンクは gh だけ
- 設定画面・テーマ選択・複数箱リストは戻さない

## エージェント

- 編集は `extension/` のみ。`/mnt/c/Users/dance/.crx/kami-copi-crx` はキャッシュなので直接編集しない。
- 反映は `bash tools/sync.sh` → 拡張の再読み込み。ファイル監視はしない。
- 権限追加・設定 UI の復活は禁止（`storage`, `sidePanel` のみ）。
- 識別子（gh URL / GAS URL / 箱名）は勝手に決めない。番号付き候補を出して選ばせる。

## 現在地

- popup v2 再構成 完了: toggle 集約（sidepanel から撤去）、CLI 案内、過去記事ボタン、下部 status（絵文字ブリンク）、フッターにブランド + gh 枠。
- 未確定: gh リンク URL（`popup/app.js` の `GH_URL` が空のため非表示）、GAS 同期（CLI は stub）。
- 未着手: `sidepanel/log.html` 分離と「プロンプトへ」コピー button、popup/sidepanel の保存キー統一（`note` vs `notes`）。
- 未検証: Chrome 実機での再読み込み後の表示確認。

## ログ

- 2026-10-19 popup を「書く＋コピる＋設定集約」に再構成、skill repo 化
