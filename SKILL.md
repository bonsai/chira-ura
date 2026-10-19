---
name: kami-copi
description: >
  Chrome 拡張「kami copi / 紙コピー」— 書いたら自動保存、コピーだけの超軽量メモ帳。
  popup に設定 toggle と CLI 案内を集約し、過去記事はサイドパネル、箱は GDrive(GAS) がマスター。
  「kami copi」「紙コピー」「メモ拡張」「popup を直す」「サイドパネル」「GAS 同期」「クリップボードに流す」
  「プロンプトに貼るボタン」で発動。英語でも発動（memo extension, clipboard note）。
---

# kami copi — 書いてコピるだけのメモ拡張

変数: `<REPO>=~/.skills/kami-copi`, `<LOAD>=/mnt/c/Users/dance/.crx/kami-copi-crx`（Chrome の unpacked 読込先）

## 構造

```
extension/
  manifest.json          MV3 / permissions: storage, sidePanel のみ
  popup/                 書く＋コピる＋設定 toggle＋CLI 案内（340×440）
  sidepanel/             過去メモ一覧・JSONL 読込・GAS 箱リンク
  background/            初期データの種付けのみ
  scripts/cli.js         設定・同期 CLI（kami set / kami sync）
  scripts/clipboard.js   コピー共通処理
  storage/db.js          chrome.storage.local ラッパ（ローカルはキャッシュ）
```

## 編集 → 読込

```bash
# 1. 編集は <REPO>/extension 側で行う
# 2. Chrome の読込先へ反映（unpacked は同期されないためコピーする）
bash tools/sync.sh          # extension/ → <LOAD> へ rsync
# 3. chrome://extensions で「再読み込み」
```

`<LOAD>` を直接編集しない。`<LOAD>` はキャッシュ、`<REPO>/extension` が正。

## UI 規約（ユーザー決定事項）

- popup は「書く／コピー」1 画面。ヘッダーは置かない。
- 設定 toggle（自動保存 / クラウド）は popup の `<details>` に集約。sidepanel には置かない。
- CLI は popup の `<details>` で案内のみ（設定画面は作らない）。
- 「過去記事」ボタンはサイドパネルを開く。
- ステータスは下部にさりげなく、**絵文字のみ**でブリンク通知:
  `📝` ローカル保存済み / `📋` クリップボード保存済み / `💾` 保存中 / `✏️` 未保存 / `⚠️` 設定不足。
  テキストは `title` に退避。
- ブランド表記はフッターのみ。フッターのリンクは gh だけ。
- コピーした内容をそのままプロンプトへ流せる形にする（前置き文を付けない）。

## 未実施（今後）

- 過去記事を `sidepanel/log.html` に分離し、各メモに「プロンプトへ」コピー button を付ける。
- popup の保存先が `note`（単数）で sidepanel の `notes`（配列）と不一致。統一が必要。
- GAS 同期は `scripts/cli.js` が stub。`gasUrl` / `defaultBox` の書き込み経路も未実装。
- gh リンク先 URL 未確定（`popup/app.js` の `GH_URL`）。

## 禁止

- 拡張内に設定画面・テーマ選択・複数箱リストを戻さない（user.review.json の ultra_minimal 決定）。
- 権限を増やさない（`storage`, `sidePanel` のみ）。
