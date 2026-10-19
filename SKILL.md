---
name: chira-ura
description: >
  Chrome 拡張「chira-ura / チラ裏」— 書いたら自動保存、コピーだけの軽量メモ帳。
  popup は動詞コマンド（書く/読む/箱/イシュー/履歴）、書く/読むはサイドパネル、
  箱は local / GDrive / GitHub / Box を OAuth で選び、CLI とは localhost ブリッジで同期（GDrive が正）。
  「chira-ura」「チラ裏」「メモ拡張」「popup を直す」「サイドパネル」「箱を変える」「プロンプトに貼る」
  で発動。英語でも発動（memo extension, clipboard note）。
---

# chira-ura — 書いてコピるだけのメモ拡張

変数: `<REPO>=~/.skills/chira-ura`, `<LOAD>=<LOAD>`（Chrome の unpacked 読込先）

旧名 `kami copi` は `kamicopi.net` と衝突するため 2026-10-19 に改名。

## 構成

```
crx/                    拡張の実体（Chrome に読ませるのはここ）
  manifest.json         MV3 / permissions: storage, sidePanel, identity, identity.email, alarms
  popup/                動詞コマンドのみ（書く/読む/箱/イシュー/履歴）
  sidepanel/write.html  書く（エディタ + コピー）
  sidepanel/read.html   過去記事を読む（展開・コピー）
  background/           ブリッジ pull（GDrive が正）+ 初期データ
  scripts/              auth.js / boxes.js / bridge.js / flash.js / clipboard.js
  storage/db.js         chrome.storage.local ラッパ
cli/                    設定・同期 CLIENT（bin: chira）
  cli.js                set / get / box / client-id / path / keys / serve / pull / push / sync
  sync.sh               crx/ → <LOAD> へ流し込む
  package.json
dev/                    開発資料
  dev.history.md        指示と変更の履歴（新しいものが上）
  ui.yaml               見た目・要素（実装の正）
  ux.yaml               振る舞い・遷移・状態・手動確認
  user.review.json      初期の ultra_minimal 決定
SKILL.md / README.md    ルート据え置き（skill 検出と GitHub の入口）
```

## 編集 → 読込

```bash
bash cli/sync.sh    # crx/ → <LOAD>。rsync なので削除も反映
# chrome://extensions で「再読み込み」
```

`<LOAD>` を直接編集しない。`<LOAD>` はキャッシュ、`<REPO>/crx` が正。

## UI 規約（ユーザー決定事項）

- popup は**動詞コマンドのみ**: 書く / 読む / 箱 / イシュー / 履歴。入力欄は置かない。
- コピー・積む・取る・読み込む は置かない（2026-10-19 削除）。読込は箱に統合。
- 箱 = 保存先（local/gdrive/gh/box）+ フォルダ（folder ID/URL）+ ファイル（JSONL）。
- 書くのは sidepanel。`write.html` = 書く、`read.html` = 過去記事を読む。
- brand は popup 最下部のみ。gh リンクは「イシュー」（issues/new）と「履歴」（README）に統合。
- 自動保存は既定 on。popup 下部のスイッチで切替。
- ステータスは下部にさりげなく、**絵文字のみ**でブリンク:
  `📝` 保存済み / `📋` コピー済み / `💾` 保存中 / `✏️` 未保存 / `🗂` 読込 /
  `📦` 箱 / `🔑` 認証・鍵 / `⚠️` 設定不足 / `✖️` 対象なし / `🚫` 失敗。テキストは `title` に退避。
- コピーは本文のみ（前置き・タイトルを付けない）＝そのままプロンプトに流せる。
- メモのタイトルは本文1行目から導出。

## 認証・同期

- 認証は OAuth。トークンは保存しない（Google = `chrome.identity.getAuthToken`、GH/Box = コード取得まで）。
- `~/.config/chira-ura/keys.json` は非秘密のみ（folder ID、client_id、GAS URL）。
- 同期の意味は「GDrive が正」だけ。`chira serve` が GDrive ミラーを配り、拡張は 5 分 alarm で pull。
  拡張から push しない。
- GDrive の箱フォルダ ID は repo に書かない。OAuth 後に Drive API で解決し、ローカル設定（`~/.config/chira-ura/keys.json`）にのみ持つ。
- version は変更単位で細かく上げ、`version_name` に `-dev` を付ける。`dev/dev.history.md` に追記。

## 未実施

- Google OAuth の `client_id` 未発行（manifest が `REPLACE_ME`）→ `chira client-id <id>` が必要。
- GH / Box は認可コード取得まで。トークン交換はサーバ（GAS 等）側が未実装。
- 箱への実際の保存・読み出しは未実装（bridge は設定のミラーのみ）。

## 禁止

- 商標 `kami copi` / `kamicopi` を名前に戻さない。
- 設定画面・テーマ選択・複数箱リストを拡張内に作らない。
- トークンを平文 JSON に置かない。
