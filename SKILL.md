---
name: chira-ura
description: >
  Chrome 拡張「chira-ura / チラ裏」— 書いたら自動保存、コピーだけの軽量メモ帳。
  popup は動詞コマンド7つ、書く/読むはサイドパネル、箱は local / GDrive / GitHub / Box を OAuth で選ぶ。
  「chira-ura」「チラ裏」「メモ拡張」「popup を直す」「サイドパネル」「箱を変える」「クリップボードに積む」
  「プロンプトに貼る」で発動。英語でも発動（memo extension, clipboard stack）。
---

# chira-ura — 書いてコピるだけのメモ拡張

変数: `<REPO>=~/.skills/chira-ura`, `<LOAD>=<LOAD>`（Chrome の unpacked 読込先）

旧名 `kami copi` は `kamicopi.net` と衝突するため 2026-10-19 に改名。

## 構造

```
crx/
  manifest.json          MV3 / permissions: storage, sidePanel, identity, identity.email
  popup/                 動詞コマンドのみ（書く/読む/コピー/積む/取る/読み込む/箱）
  sidepanel/index.html   書く（エディタ + コピー）
  sidepanel/log.html     過去記事を読む（展開・コピー）
  background/            初期データの種付けのみ
  scripts/cli.js         設定 CLI（chira set / box / client-id / path / keys）
  scripts/auth.js        OAuth（Google=getAuthToken、GH/Box=launchWebAuthFlow）
  scripts/boxes.js       箱の定義と鍵のマージ
  scripts/stack.js       クリップボードの積みキュー（LIFO・最大50・先頭が最新）
  scripts/bridge.js      localhost ブリッジ（GET/PUT http://127.0.0.1:8787/state）
  scripts/flash.js       絵文字のみの status 通知
  scripts/clipboard.js   コピー共通処理
  storage/db.js          chrome.storage.local ラッパ（ローカルはキャッシュ）
```

## 編集 → 読込

```bash
# 編集は crx/ 側で行う（<LOAD> はキャッシュ、直接編集しない）
bash tools/sync.sh          # crx/ → <LOAD> へ rsync
# chrome://extensions で「再読み込み」
```

## UI 規約（ユーザー決定事項）

- popup は**動詞コマンドのみ**（最大7）。入力欄は置かない。値は右に小さく出す。
- popup の最下部は brand、その直上に gh。sidepanel には brand / gh を置かない。
- 書くのは sidepanel。`index.html` = 書く、`log.html` = 過去記事を読む。
- 箱・読み込みは popup 側。サイドパネルに置かない。
- 自動保存は既定 on。popup 下部のスイッチで切替（コマンド行にしない）。
- ステータスは下部にさりげなく、**絵文字のみ**でブリンク:
  `📝` ローカル保存済み / `📋` コピー済み / `💾` 保存中 / `✏️` 未保存 /
  `🗃` 積んだ / `📤` 取った / `🔑` 認証・鍵 / `📦` 箱 / `🗂` 読込 / `⚠️` 設定不足 / `🚫` 失敗。
  テキストは `title` に退避。
- コピーは内容のみ（前置き・タイトルを付けない）＝そのままプロンプトに流せる。
- メモのタイトルは本文1行目から導出（入力欄を増やさない）。
- 認証は **OAuth**。トークンは保存しない。`~/.config/chira-ura/keys.json` は非秘密のみ
  （folder ID、client_id、GAS URL）。
- GDrive 箱フォルダ: `<folder-id>`（<account>）。
- version は変更単位で細かく上げる。`version_name` に `-dev` を付ける。
- 同期の意味は「GDrive が正」だけ。CLI（`chira serve`）が GDrive ミラーを配り、
  拡張は background の alarm で pull する。**拡張から push しない**。

## 未実施

- Google OAuth の `client_id` 未発行（manifest が `REPLACE_ME`）→ `chira client-id <id>` が必要。
- GH / Box は認可コード取得まで。トークン交換はサーバ（GAS 等）側が未実装。
- 同期（`chira sync`）は stub。箱への書き込み・読み込みは未実装。
- popup の旧キー `note`（単数）が残骸。sidepanel は `notes`（配列）。

## 禁止

- 商標 `kami copi` / `kamicopi` を名前に戻さない。
- 設定画面・テーマ選択・複数箱リストを拡張内に作らない。
