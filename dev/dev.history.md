# dev.history — chira-ura

指示と実装の履歴。新しいものが上。

## 2026-10-19 / v0.1.0-rel — 初回公開リリース

- 指示: release v0.1.0-rel / ID は repo に置かず OAuth で解決 / 1（識別子を消してから public）
- 変更: フォルダ ID とメールアドレスを repo から削除（履歴も filter-repo で置換）。
  `crx/scripts/drive.js` を追加し、フォルダは OAuth 後に Drive API で解決（名前 or ID → ID）。
  popup の「フォルダ」は保存時に解決する。version を 0.1.0 / `version_name: 0.1.0-rel` に。
  `.gitignore` に dist/ と keys.json。zip を release に添付して repo を public 化。

## 2026-10-19 / v2.5.4-dev — ux.yaml 追加

- 指示: make ux.yaml
- 変更: `dev/ux.yaml`（振る舞い・遷移・状態）。`dev/ui.yaml` は見た目、`dev/ux.yaml` は流れの分担。
  手動確認チェックリストもここに置く。

## 2026-10-19 / v2.5.3-dev — doc/ を dev/ に改名

- 指示: doc から dev に変更。
- 変更: `doc/` → `dev/`（dev.history.md, ui.yaml, user.review.json）。参照を全置換。

## 2026-10-19 / v2.5.2-dev — repo を doc / crx / cli の3構成に

- 指示: doc crx cli の構成にする。
- 変更: `cli/`（cli.js, package.json, sync.sh）/ `crx/`（拡張のみ）/ `dev/`（dev.history.md, ui.yaml, user.review.json）。
  `SKILL.md` と `README.md` は skill 検出と GitHub の入口なのでルート据え置き。
  `cli.js` の manifest 参照を `../crx/manifest.json` に変更。
- 同期手順は `bash cli/sync.sh`。

## 2026-10-19 / v2.5.1-dev — サイドのファイル名を write/read に

- 指示: `write.html` `read.html` で直す。
- 変更: `sidepanel/index.html` → `write.html`（+ write.js）、`log.html` → `read.html`（+ read.js）。
  manifest `side_panel.default_path` と popup のパス、相互リンクを更新。

## 2026-10-19 / v2.5.0-dev — popup を 5 コマンドに削減

- 指示: コピー不要。積むは意味不明で不要。取るは読むと同義。読み込むは「ちょっとしたものを読みたい」なので
  箱のフォルダ・ファイル指定に統合。イシュー作成は gh リンクに飛ばす（gh リンクを統合）。
  開発履歴を読むは gh README にリンク。
- 変更: popup = 書く / 読む / 箱 / イシュー / 履歴。
  箱パネルに「フォルダ」（folderId/URL）と「ファイル」（JSONL 読込）を統合。
  フッターの gh リンクを廃止し、brand のみ最下部。
  `scripts/stack.js` と積みキュー（積む/取る）を削除。コピーはサイドパネルにのみ残す。

## 2026-10-19 / v2.4.0-dev — CLI ⇄ 拡張のブリッジ（GDrive が正）

- 指示: CLI⇄crx の同期は localhost ブリッジ（選択肢2）。CLI 側にも同種のクライアントを実装。
  同期の意味は「GDrive が正」だけ。
- 変更: `crx/scripts/bridge.js`（protocol: `GET/PUT http://127.0.0.1:8787/state`）。
  background が 5 分 alarm + 起動時に pull し、`keys` / `box` / `gasUrl` / `bridgeRev` を `chrome.storage` に写す。
  拡張からは push しない（正は GDrive）。`chira serve`（サーバ）/ `chira pull` / `chira push` / `chira sync`。
- 権限: `alarms` 追加、`host_permissions: http://127.0.0.1:8787/*`。background を `type: module` に。
- 検証: GET/PUT と rev 増加、`chira pull` を実測。8765 は別プロセスが使用中だったため 8787 に決定。

## 2026-10-19 / v2.3.0-dev — 改名（商標回避）

- 指示: `http://kamicopi.net/` と衝突＝商標違反なので名を変える。新名 `chira-ura`。
- 変更: manifest `name` → `chira-ura / チラ裏`、brand 表記 → `chiraura`、CLI のコマンド名 `kami` → `chira`、
  鍵ファイル `~/.config/kami-copi/keys.json` → `~/.config/chira-ura/keys.json`、
  Chrome 読込先 `~/.crx/kami-copi-crx` → `~/.crx/chira-ura-crx`、repo `bonsai/kami-copi` → `bonsai/chira-ura`。
- 注意: 読込先が変わったので拡張 ID が変わる。旧 ID の `chrome.storage.local` は引き継がれない。
  `chrome://extensions` で旧エントリを削除し、`chira-ura-crx` を読み込み直す。

## 2026-10-19 / v2.2.0-dev — OAuth 化

- 指示: key を平文 JSON で CLI 設定 →「set by oauth is better」。
- 変更: `chrome.identity` を導入（`identity`, `identity.email`）。Google は `getAuthToken`（scope `drive.file`）、
  GitHub / Box は `launchWebAuthFlow` でコード取得まで。トークンは保存しない。
  `scripts/auth.js` / `kami client-id` コマンド（manifest の `oauth2.client_id` を書く）。
- 残: `client_id` 未発行（`REPLACE_ME`）。GH/Box のトークン交換はサーバ（GAS）側が未実装。

## 2026-10-19 / v2.1.0 — 箱・積みキュー・コマンド動詞化

- 指示: 箱は local / gdrive / gh / box を API 設定で選ぶ。自動保存は当然でトグル。箱と読み込みはサイドから popup へ。
  CLI から key 設定（この時点は平文 JSON）。コマンドは動詞のみ。
- GDrive の箱フォルダ ID は repo に書かない。OAuth 後に Drive API で解決し、ローカル設定（`~/.config/chira-ura/keys.json`）にのみ持つ。
- 変更: `scripts/boxes.js`（箱の定義）/ `scripts/stack.js`（クリップボード LIFO、最大50、連投の重複は無視）。
  popup を動詞7つ（書く/読む/コピー/積む/取る/読み込む/箱）に。箱パネル + 自動保存スイッチ。
  sidepanel から箱・読込を撤去（過去記事は読むだけ）。

## 2026-10-19 / v2.0.0 — popup をコマンドのみに

- 指示: popup はコマンドのみ、7つまで、最下部が brand、その上が gh。note 側からはロゴとリンクを消す。
- 変更: popup の textarea 撤去。コマンド行のみ。`gh` → `brand` の順で最下部に固定。
  sidepanel（書く / 過去記事）から brand と gh を撤去。

## 2026-10-19 / v2.0.0 — sidepanel を書く/読むに分離

- 指示: 過去記事は `sidepanel/read.html` に分離。status は下部、brand と gh はフッターのみ。
- 変更: `sidepanel/write.html`（書く）/ `sidepanel/read.html`（過去記事）。コピーは本文のみ（前置き無し）。
  タイトルは本文1行目から導出。`scripts/flash.js` を新設し、通知を絵文字のみ（📝/📋/💾/✏️/🗂/⚠️/🚫）に統一。

## 2026-10-19 / v2.0.0 — skill 化

- 指示: `make skills`。
- 変更: `~/.skills/<name>/` に SKILL.md + README + `crx/` を置く形で repo 化。`gh repo create --private`。
  Chrome 読込先は `cli/sync.sh` で流し込むキャッシュ扱い。

## 2026-10-19 / v2.0.0 — popup 再構成

- 指示: 設定 toggle を popup に集約、CLI の紹介、過去記事はサイドで読む、コピーはプロンプトに流せる形、
  status は下部にさりげなく、brand はフッターのみ、gh リンク、絵文字のみでブリンク通知。
- 変更: popup に `<details>`（設定 / CLI）とブランド・gh フッター。sidepanel から toggle 撤去。
  ステータスを絵文字ブリンクに（`📝` ローカル保存済み / `📋` クリップボード保存済み）。

## 運用

- version は変更単位で細かく上げる。`version_name` に `-dev` を付ける。
- 実体は `crx/`。`~/.crx/chira-ura-crx` はキャッシュ（直接編集しない）。
- 反映は `bash cli/sync.sh` → `chrome://extensions` で再読み込み。
