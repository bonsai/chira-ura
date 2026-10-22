---
name: chira-ura
description: >
  Chrome 拡張「chira-ura / チラ裏」— 書いたら自動保存、コピーだけの軽量メモ帳。
  popup は動詞コマンド（箱を設定する/読む/書く）+ 自動保存・自動同期スイッチ、書く/読むはサイドパネル、
  箱は local / GDrive / GitHub / Box を OAuth で選び、CLI とは localhost ブリッジで同期（GDrive が正）。
  「chira-ura」「チラ裏」「メモ拡張」「popup を直す」「サイドパネル」「箱を変える」「プロンプトに貼る」
  で発動。英語でも発動（memo extension, clipboard note）。
---

# chira-ura — 書いてコピるだけのメモ拡張

変数: `<REPO>=~/.skills/chira-ura`, `<LOAD>=<Chrome の unpacked 読込先>`（`CHIRA_LOAD_DIR` で指定。既定は `~/.crx/chira-ura-crx`）

旧名 `kami copi` は `kamicopi.net` と衝突するため 2026-10-19 に改名。

## 構成

```
crx/                    拡張の実体（Chrome に読ませるのはここ）
  manifest.json         MV3 / permissions: storage, sidePanel, identity, identity.email, alarms
  popup/                箱を設定する / 読む / 書く + ver（履歴）/ ロゴ（サイト）
  sidepanel/write.html  書く（エディタ + コピー）
  sidepanel/read.html   過去記事を読む（展開・コピー）
  background/           ブリッジ pull（GDrive が正）+ 初期データ
  scripts/              auth.js / boxes.js / bridge.js / flash.js / clipboard.js
    model.js            メモの型（拡張と CLI が共用。deriveTitle / parseJsonl / toJsonl / DB_SCHEMA）
  storage/db.js         chrome.storage.local ラッパ
cli/                    設定・同期 CLIENT（bin: chira。`bash cli/install.sh` で PATH へ）
  cli.js                set / get / box / client-id / path / keys / serve / pull / push / sync
                         + db / notes / note / export / import / storage（メモ）
  ura-db.js             ~/.chira/ura.db（node:sqlite。メモの正 JSON）
  install.sh            ~/.local/bin/chira に symlink（skill から `chira` を直接叩く）
  install.ps1           Windows 版。~/.local/bin/chira.cmd を PATH へ
  sync.sh               crx/ → <LOAD> へ流し込む
  package.json
dev/                    開発資料
  dev.history.md        指示と変更の履歴（新しいものが上）
  ui.yaml               見た目・要素（実装の正）
  ux.yaml               振る舞い・遷移・状態・手動確認
  chira-ura.puml        構成図（PlantUML）
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

- popup は**動詞コマンドのみ**: 箱を設定する（右に自動同期 switch）/ 読む / 書く。入力欄は置かない。
- コピー・積む・取る・読み込む は置かない（2026-10-19 削除）。読込は箱に統合。
- 箱 = 保存先（local/gdrive/gh/box）+ フォルダ（folder ID/URL）+ ファイル（JSONL）。
- 書くのは sidepanel。`write.html` = 書く、`read.html` = 過去記事を読む。
- 最下部は `ver <version_name>`（→ dev/dev.history.md）とロゴ（→ https://bonsai.github.io/chira-ura/）だけ。イシューリンクは置かない。
- 自動保存は既定 on。popup 下部のスイッチで切替。
- ステータスは下部にさりげなく、**絵文字のみ**でブリンク:
  `📝` 保存済み / `📋` コピー済み / `💾` 保存中 / `✏️` 未保存 / `🗂` 読込 /
  `📦` 箱 / `🔑` 認証・鍵 / `⚠️` 設定不足 / `✖️` 対象なし / `🚫` 失敗。テキストは `title` に退避。
- コピーは本文のみ（前置き・タイトルを付けない）＝そのままプロンプトに流せる。
- メモのタイトルは本文1行目から導出。

## CLI スキル（oauth 経由）

```bash
bash cli/install.sh        # ~/.local/bin/chira（初回だけ）
chira auth                 # ブラウザ同意 → ~/.config/chira-ura/token.json (0600)
chira token                # 有効な access token（期限切れは refresh）
chira logout
chira box gdrive           # 箱を CLI から指定（引数なしで現在値）
chira serve                # ブリッジ（拡張が 5 分毎に pull）
```

- CLI も拡張と同じ OAuth クライアント（`chira client-id`）= `oauth.clientId` を使う。
- client_secret は `chira set oauth.clientSecret <secret>`（desktop client のもの。0600 でローカルのみ）。
- トークンは repo に置かない。`~/.config/chira-ura/` のみ。

## メモ（CLI）

拡張と同じ JSON（`{id, title, content, updatedAt}`）を SQLite に持つ。DB は `~/.chira/ura.db`（`CHIRA_DB` で変更可）。

```bash
chira db init            # DB を作る（~/.chira/ura.db）
chira notes              # 一覧（新しい順）
chira note add "本文"     # 追加（タイトルは本文1行目から）
chira export             # notes → JSONL（箱のファイル形式と同じ）
chira import file.jsonl  # JSONL → notes（同じ id は新しい updatedAt を採用）
chira storage export     # chrome.storage.local 相当の JSON
chira db export <dir>    # canonical（schema.sql + notes.jsonl + meta.jsonl）
chira db import <dir>    # canonical から読み込む
```

- 同じ .db を端末間でやり取りできる（journal=DELETE なので 1 ファイルで完結）。
- canonical の形は sync-db と同じ（`schema.sql` + `<table>.jsonl`）。
- 拡張との自動同期は未実施。受け渡しは JSONL / canonical 経由。

## 認証・同期

- 箱は CLI から指定できる（`chira box gdrive` → keys.json → ブリッジ → 拡張が pull）。
- 箱選択は 1 度目は無言トークン（同意画面を飛ばす）。同じ箱を再度押すと同意画面。
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
