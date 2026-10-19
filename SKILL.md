---
name: kami-copi
description: >
  Chrome 拡張「kami copi / 紙コピー」— 書いたら自動保存、コピーだけの超軽量メモ帳。
  popup に設定 toggle と CLI 案内を集約し、過去記事はサイドパネル、箱は GDrive(GAS) がマスター。
  「kami copi」「紙コピー」「メモ拡張」「popup を直す」「サイドパネル」「GAS 同期」「クリップボードに流す」
  「プロンプトに貼るボタン」で発動。英語でも発動（memo extension, clipboard note）。
---

# kami copi — 書いてコピるだけのメモ拡張

変数: `<REPO>=~/.skills/kami-copi`, `<LOAD>=<LOAD>/.crx/kami-copi-crx`（Chrome の unpacked 読込先）

## 構造

```
crx/
  manifest.json          MV3 / permissions: storage, sidePanel のみ
  popup/                 コマンド一覧のみ（最大7行・最下部 brand・その上 gh）
  sidepanel/index.html   書く（エディタ + コピー）
  sidepanel/log.html     過去記事を読む（一覧・展開・JSONL 読込・箱リンク）
  background/            初期データの種付けのみ
  scripts/cli.js         設定・同期 CLI（kami set / kami sync）
  scripts/clipboard.js   コピー共通処理
  scripts/flash.js       絵文字のみの status 通知（popup / sidepanel 共用）
  storage/db.js          chrome.storage.local ラッパ（ローカルはキャッシュ）
```

## 編集 → 読込

```bash
# 1. 編集は <REPO>/extension 側で行う
# 2. Chrome の読込先へ反映（unpacked は同期されないためコピーする）
bash tools/sync.sh          # crx/ → <LOAD> へ rsync
# 3. chrome://extensions で「再読み込み」
```

`<LOAD>` を直接編集しない。`<LOAD>` はキャッシュ、`<REPO>/crx` が正。

## UI 規約（ユーザー決定事項）

- popup は**コマンド一覧のみ**（最大7行）。入力欄は置かない（書くのは sidepanel）。
- popup の並び: コマンド（書く/過去記事/コピー/自動保存/クラウド/CLI/箱）→ 最下部に brand、その直上に gh。
- 設定 toggle（自動保存 / クラウド）は popup の `<details>` に集約。sidepanel には置かない。
- CLI は popup の `<details>` で案内のみ（設定画面は作らない）。
- sidepanel は 2 ページに分離: `index.html` = 書く、`log.html` = 過去記事を読む。
  popup の「過去記事」は `chrome.sidePanel.setOptions({path: 'sidepanel/log.html'})` → `open()`。
  両ページのフッターで相互に行き来（`index.html` ⇄ `log.html`）。
- 全画面で共通: ステータスは下部にさりげなく、**絵文字のみ**でブリンク通知:
  `📝` ローカル保存済み / `📋` クリップボード保存済み / `💾` 保存中 / `✏️` 未保存 /
  `🗂` 読込完了 / `⚠️` 設定不足 / `✖️` 対象なし / `🚫` 失敗。テキストは `title` に退避。
- brand と gh は popup の最下部のみ。sidepanel（書く/過去記事）には置かない。
- コピーは内容のみ（タイトルや前置きを付けない）＝そのままプロンプトに流せる。
- メモのタイトルは本文1行目から導出する（タイトル入力欄を作らない）。

## 未実施（今後）

- popup の保存先が `note`（単数）で sidepanel の `notes`（配列）と不一致。統一が必要。
- GAS 同期は `scripts/cli.js` が stub。`gasUrl` / `defaultBox` の書き込み経路も未実装。
（解決済み）gh リンク = https://github.com/bonsai/kami-copi

## 禁止

- 拡張内に設定画面・テーマ選択・複数箱リストを戻さない（user.review.json の ultra_minimal 決定）。
- 権限を増やさない（`storage`, `sidePanel` のみ）。
