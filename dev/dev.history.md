# dev.history — chira-ura

指示と実装の履歴。新しいものが上。

## 2026-11-06 / v0.1.11-dev — ADR-002: wiki push 前の整形 / 埋め込みパイプライン設計（raw 不変・weaver/rag 分離）

- 指示: wiki push 前の整形 / 埋め込みの設計（raw 不変・weaver/rag 分離）。
- 変更:
  - `dev/adr-002-wiki-pipeline.md`: 送信前整形・埋め込みの要否に関する決定レコード（ADR）を策定。
    - 決定: 送信前整形および embedding は行わず、chira-ura は raw のまま 10 件ずつ 1 コミットで push する（速さとオフライン耐性を最大化、一次情報の損失防止）。
    - 構造化プロンプト設計: 「pain のメモ → アイデア / 作業 / 目的 / 実装」への構造化仕様（YAML frontmatter、元 raw 参照 sources）を定義。
    - モデル選定・評価: 長文バッチ醸成用（Qwen2.5-72B/32B, Llama-3.1-70B, Gemini 1.5 Pro）および検索 embedding 用（bge-m3, text-embedding-3）を比較評価。
    - 三層整合性: 生メモ（raw）不変、構造化・醸成は weaver（ripe/）、embedding は rag の責務分担を確立。
  - `dev/layers.md`: ADR-002 決定事項を三層アーキテクチャ定義へ反映。

## 2026-11-06 / v0.1.10-dev — モバイルクライアント（iOS / Android — gui/iphone, gui/apk, gui/mobile）

- 指示: モバイルクライアント（iOS / Android — gui/iphone, gui/apk）。設計 dev/mobile-design.md。
- 変更:
  - `gui/mobile/`: Flutter (Dart) によるクロスプラットフォーム（iOS / Android）付箋メモクライアントを実装。
    - `lib/model/note.dart`: 既存共通メモスキーマ `{ id, title, content, updatedAt }`、1行目タイトル導出（`deriveTitle`、最大30文字）および Base36 ID 生成。
    - `lib/storage/outbox_store.dart`: オフライン優先のファイルベース outbox リポジトリ（`<id>.json`、タイムスタンプ順整列）。
    - `lib/sync/sync_service.dart`: Cloudflare Worker FE API (`PUT /inbox/<id>.txt`) 送信クライアント。既定 10 件ずつのバッチ送信、Bearer 認証、送信成功時の outbox 削除（冪等）、オフライン・通信障害時の静かな失敗と未送信保持。
    - `lib/ui/sticky_note_page.dart` / `lib/main.dart`: 爆速起動（コールドスタート < 300ms 目安）、日本語入力 IME 既定対応（multiline / autofocus）、350ms デバウンス自動保存、ステータス絵文字表示（📝/✏️/💾/☁️）。
    - `test/note_test.dart`, `test/outbox_test.dart`, `test/sync_test.dart`: 単体テスト群を追加（スキーマ互換、タイトル抽出、outbox CRUD、10件バッチ送信、冪等性、オフライン復旧）。
  - `gui/iphone/`: `build.sh`（iOS ビルドスクリプト）と README を更新。
  - `gui/apk/`: `build.sh`（APK ビルドスクリプト）と README を更新。
  - `dev/mobile-design.md`, `gui/README.md`: 実装完了と受け入れ条件達成を反映。

## 2026-11-06 / v0.1.10-dev — 三層 UML（Mermaid / PlantUML）と gh wf レンダリング

- 指示: make uml / mmd でも書いて。ビルドは gh workflow で。
- 変更:
  - `dev/layers.mmd`（Mermaid）/ `dev/layers.puml`（PlantUML）を追加。
  - `.github/workflows/diagrams.yml`: `.mmd`→SVG（mermaid-cli）+ `.puml`→SVG（plantuml.jar）を実行し artifact 化。`dev/puppeteer.json` を追加。
  - `m = wiki, weaver` / `v = rag, llm` / `c = mcp, cli` に確定。

## 2026-11-06 / v0.1.10-dev — 三層アーキ（dump / weaver / rag）と別レポ

- 指示: 書き殴る層・醸成する層・選び出す層を痎結合に、別レポで。
- 変更:
  - `dev/layers.md`: 三層アーキを定義。
    - 書き殴る（dump）= `bonsai/chira-ura`
    - 基盤 = `bonsai/wiki`（**貯めるだけ**・不変ストア）
    - 醸成 = **weaver（織姫）agent** = 再構成・再生成 + メタデータ
    - 選び出し = **rag** = 読み出す・呼び出せる
  - 別レポ **`bonsai/weaver`**・**`bonsai/rag`** を作成（private, README のみ）。
  - `m = wiki,weaver` / `v = rag` / `c = （未定）`。

## 2026-11-06 / v0.1.9-dev — モバイルクライアント設計 doc

- 指示: doc を書いて issue を作成。
- 変更: `dev/mobile-design.md` を追加（iOS/Android = `gui/iphone`, `gui/apk` の設計・共通要件・技術候補・受け入れ条件）。

## 2026-11-06 / v0.1.9-dev — index.html をタブ式に

- 指示: `index.html` に crx / win / cli / … を別タブで。
- 変更: `index.html` をタブ UI に刷新（概要 / crx / cli / api / win / rust / mobile / dev）。`location.hash` でタブ保持。`gui/` 構成（win/rust/mobile）を反映。

## 2026-11-06 / v0.1.9-dev — gui/win UI 刷新（フッター集約・IME・保存通知）

- 指示: Windows 付箋クライアントの UI を作り直す。
  - 起動で白紙・すぐ書ける / 📝 ステータス / ＋ で次の白紙 / ✕ で終了
  - ヘッダ廃止、フッターを高くして三等分（📝 ｜ ＋ ｜ ✕）
  - スクロールバー無し、デフォルトはスマホサイズ（360x640）
  - 日本語入力を明示（IME ひらがな）
  - 保存したら吹き出しでファイル名を通知
- 変更:
  - `gui/win/ChiraUra.Win/StickyNoteForm.cs`: `TableLayoutPanel` で 2 段（本文 / フッター三等分）。ヘッダ撤去、`ScrollBars=None`、`ImeMode=Hiragana`、保存時に ToolTip バルーンでファイル名を表示。
  - `gui/win/ChiraUra.Win/ChiraUra.Win.csproj`: `<AssemblyName>chira</AssemblyName>`（exe 名 `chira.exe`）。
  - `gui/win/ChiraUra.Win/Program.cs`: 未捕捉例外を `~/.chira/chira-crash.log` に記録。
  - `gui/win/ChiraUra.Win/chira.svg` / `chira.ico`: アプリアイコン（付箋＋折り返し＋罫線）。`<ApplicationIcon>` と Window アイコンに設定。

## 2026-11-06 / v0.1.9-dev — CLI `chira wiki`（オフライン蓄積 → bonsai/wiki raw/ へ一括 push）

- 指示: オフラインでタイムスタンプでメモをため、オンラインでまとめて `bonsai/wiki/raw` へ push。**送信は CLI（cli.js）と痎結合でよい。クライアントは保存だけ**。
- 変更:
  - `cli/wiki-push.js`: 未送信メモを **10 件ずつ 1 コミット**で `bonsai/wiki` の `raw/<MM>/<timestamp>_<id4>.txt` へ push。GitHub Git Data API（`api/src/wiki-push.js` と同じ手順）。送信済みは meta（`sync.wiki`）で管理し冪等。失敗バッチは未送信として残しリトライ。
  - `cli/cli.js`: `chira wiki` コマンドを追加。
  - 認証: `CHIRA_GH_TOKEN` → `GITHUB_TOKEN` → `gh auth token` の順で解決（`gh push`）。
  - `test/wiki-push.test.js`: バッチ（25件→3コミット）、冪等、失敗時の保持、パス `raw/<MM>/`、トークン解決を検証。
  - `.github/workflows/cli.yml`: gh workflow で CLI テストを実行。

## 2026-11-06 / v0.1.8-dev — GUI モノレポ化と API ディレクトリ統合

- 指示: ディレクトリ再編。
  - Worker → `api/`（旧 `worker/`）
  - GUI を `gui/` 配下にプラットフォーム別で集約し、`gui/rust`, `gui/win`, `gui/iphone`, `gui/apk` とする
- 変更:
  - `worker/` → `api/` にリネーム（PR #18 で main にマージ。FE API + cron + MCP を統合）。
  - `rs/` → `gui/rust/` にリネーム。`gui/README.md` を追加。
  - `gui/iphone/`, `gui/apk/` を計画プレースホルダとして追加。
  - `.github/workflows/rust.yml` の対象パスを `gui/rust/**` に更新。
  - `README.md`, `SKILL.md`, `dev/benchmarks.md` の参照を `gui/` に更新。

## 2026-11-05 / v0.1.9-dev — Windowsクライアント（C#/.NET）：付箋メモ専用アプリ

- 指示: Windowsクライアント（C#/.NET）：付箋メモ専用アプリ。親: #5。付箋メモを書いて閉じると既存の経路で wiki/raw に届く状態。
- 変更: `gui/gui/win/` 配下に C# / .NET 10 ソリューション（`gui/gui/win/ChiraUra.sln`）を追加。
  - `gui/gui/win/ChiraUra.Core/`:
    - `Note.cs`: メモデータ型 `{ id, title, content, updatedAt }`、本文1行目タイトル導出（`DeriveTitle`）、ID生成
    - `NoteRepository.cs`: SQLite（`~/.chira/ura.db`）の `notes` / `meta` テーブル読み書き（DELETE journal mode、スキーマ互換）
    - `ChiraApiClient.cs`: FE API（`PUT /inbox/<name>`）送信クライアント（`CHIRA_TOKEN` 認証ヘッダ対応）
    - `SyncService.cs`: メモ保存と FE API（`/inbox/<id>.txt`）送信。オフライン時は SQLite に安全に保持されローカル下書きとして機能
  - `gui/gui/win/ChiraUra.Win/`:
    - WinForms 付箋メモ UI（`StickyNoteForm.cs`）。コールドスタートから即座にテキスト入力フォーカス、最前面ピン留め（📌）、自動保存、ウィンドウクローズ時の送信
  - `gui/gui/win/ChiraUra.Tests/`:
    - xUnit テスト（`NoteTests.cs`）で Note のタイトル導出・JSON 互換性、SQLite リポジトリ CRUD、SyncService と API クライアント送信・オフラインフォールバックを検証
  - `dev/adr-001-rs-vs-cs.md`: C# / .NET 採用を反映（Accepted）。

## 2026-11-05 / v0.1.8-dev — MCP サーバー（/mcp、pi-coding 連携）

- 指示: MCP サーバー（/mcp、pi-coding 連携）。設計 dev/cloud-design.md §7。
  - FE API と同じ Worker に /mcp（Streamable HTTP）を実装
  - 書く側ツール: chira_note_add(content) / chira_inbox_list / chira_count
  - 読む側ツール: chira_wiki_list_raw(month?) / chira_wiki_read(path) / chira_wiki_search(query)
  - 認証は FE API と同じトークン
  - pi-coding への登録手順（URL と環境変数 CHIRA_TOKEN の2点）を dev/ に記録
- 変更:
  - `api/src/mcp.js`: MCP 2026-07-28 / Streamable HTTP ルーターと 6 つのツールハンドラーを実装。
  - `api/src/index.js`: POST `/mcp` ルーティングを追加（同一認証チェック）。
  - `api/test/mcp.test.js`: 認証・ツール呼び出し・KV 書き込み・GitHub API 読み込み / 検索フォールバックの単体テストを追加。
  - `dev/mcp-setup.md`: pi-coding / MCP クライアントへの登録手順を記載。

## 2026-11-05 / v0.1.8-dev — Rust GUI クライアント（egui）— 爆速メモ（付箋）

- 指示: Rust の GUI クライアント。ADR-001 の第一候補（Rust）を実装する。#12 (C#/.NET) の対案。
- 変更:
  - `gui/rust/`（当時 `rs/`）を追加し、Rust + egui (`eframe` 0.29) による爆速付箋メモ GUI クライアントを実装。
  - 1画面付箋 UI: 起動即フォーカス、テキスト入力即ローカル outbox (`~/.chira/outbox/<id>.json`) 保存。
  - 送信: outbox → FE API (`PUT /inbox/<id>.txt`) 送信（Bearer 認証、設定/環境変数から読み出し）。オフライン時も outbox に残り、次回起動/手動で再送。
  - 計測: コールドスタート→入力可能時間の実測値 ~122ms (< 300ms 達成) を `dev/benchmarks.md` に記録。
  - ADR-001 (`dev/adr-001-rs-vs-cs.md`) を Accepted に更新。
  - ルール更新: `README.md` と `SKILL.md` の編集対象に `rs/`（現 `gui/`）を追加。

## 2026-11-04 / v0.1.8-dev — CLI `chira sync`（SQLite の未送信分 → /inbox）

- 指示: CLI `chira sync`（SQLite の未送信分 → /inbox）。設計: `dev/cloud-design.md` §9-4。
  - `~/.chira/ura.db` の未送信メモをメモ JSON のまま `PUT /inbox/<name>` へ送る
  - 送信済みの管理を meta 側に持つ（canonical export の形式を壊さない）
  - オフライン時は静かに失敗し、次回実行で送る
  - 受け入れ条件: CLI で追加したメモが `/inbox` に届く、再実行しても重複しない（同名上書きで冪等）
- 変更:
  - `cli/ura-db.js`: `getInboxSyncMeta(db)`, `markNoteSynced(db, id, syncedAt)`, `getUnsyncedNotes(db)` を追加。送信履歴は meta テーブル（キー `sync.inbox`）に記録し、canonical export / import のフォーマット・テーブル定義を壊さない。
  - `cli/cli.js`: `syncInbox(db, options)` を実装。`process.env.CHIRA_API_URL` や `keys.json` の `cloud.url` / `cloud.token` / `CHIRA_TOKEN` を参照し、各メモを `PUT /inbox/<id>.txt` へメモ JSON として送信。オフラインや通信エラー時は静かにスキップ。`chira sync` コマンドで実行可能（`chira sync pull` で旧 localhost ブリッジ pull）。
  - `test/sync.test.js`: `node --test` で /inbox への PUT 送信、meta 記録、canonical 整合性、冪等性、オフライン時の静かな失敗をテスト。

## 2026-11-05 / v0.1.8-dev — crx 1分送信（sidepanel → /inbox、ブリッジ pull の置き換え）

- 指示: crx 1分送信（sidepanel → /inbox、ブリッジ pull の置き換え）。設計: dev/cloud-design.md §4・§9-3。依存: FE API の issue。親: #5。
- 変更:
  - セッション開始時にファイル名を確定（タイムスタンプ `YYYYMMDD_HHMMSS.txt`、`crx/scripts/inbox.js` の `formatSessionName`）。
  - 保存デバウンス（600ms）+ 1分毎チェック（`checkAndSyncInbox`）で、変更分を `PUT /inbox/<name>` へ全文化・同名上書きで送信。
  - closed 送信トリガー:
    1. NEW 押下時（`btnNew` で現セッションを `closed: true` 送信後、新セッション名発行）。
    2. ページを閉じる時（`pagehide` イベントで `sendBeacon` または `keepalive: true` の PUT 送信）。
    3. 10分無更新時（無操作タイマーで `closed: true` 送信）。
  - オフライン時は `chrome.storage.local` の `inboxPending` に未送信分を保持し、オンライン復帰時（`online` イベント）や次回の1分チェックで再送。
  - 送信先 URL とトークンは設定値（`chrome.storage.local` の `inboxUrl` / `inboxToken` または `keys.inbox`）として保持し、実値は repo に書かない。
  - 現行の localhost ブリッジ pull（`background/service-worker.js`）との関係:
    - 決定: クラウド化方針（`dev/cloud-design.md` §9-3）に基づき、メモ送信は `/inbox` への push を正とする。常時 5分 alarm による localhost ブリッジ pull はデフォルト無効化（置き換え）。
    - 既存環境との後方互換性のため、`keys.bridgeEnabled` または `bridgeEnabled` 設定が明示的に `true` の場合のみ localhost ブリッジ pull を実行する併用オプトイン形式とする。

## 2026-11-05 / v0.1.8-dev — Cloudflare Worker FE API（/inbox・KV キャッシュ・トークン認証）

- 指示: Cloudflare Worker FE API（/inbox・KV キャッシュ・トークン認証）。親: #5。
- 変更: `api/` 配下に Cloudflare Worker プロジェクトを追加（`api/src/index.js`, `api/wrangler.json`, `api/package.json`）。
  - エンドポイント:
    - `PUT /inbox/<name>`: body の content + updatedAt + closed を KV に保存（同名上書き・TTL 7日）。title は content 1行目から導出
    - `GET /inbox`: キャッシュ一覧（name, title, updatedAt, closed）
    - `GET /count`: 件数（count）と最終受信時刻（lastReceivedAt、死活確認用）
  - 認証: `Authorization: Bearer <token>` または `X-Chira-Token: <token>`。未指定・不正時は 401 Unauthorized
  - 秘密情報: 実値は repo に含めず `wrangler secret put CHIRA_TOKEN` で投入
  - テスト: `node --test`（`api/test/worker.test.js`）で認証・KV 操作・タイトル抽出を検証

## 2026-11-04 / v0.1.8-dev — storage shim + chira serve 静的配信（crx HTML のローカル起動・オフラインメモ）

- 指示: storage shim + `chira serve` 静的配信（crx HTML のローカル起動・オフラインメモ）。dev/cloud-design.md §4.5 入口1の実装。
- 変更:
  - `crx/scripts/storage-shim.js` を追加: chrome.storage が無い環境でのみ、window.chrome.storage.local 互換を localStorage 裏で提供（対象キー: notes / activeNoteId / autoSave）。同一ページ内の set で自前発火、他タブとは window.storage イベントで同期。拡張環境では実物が優先され shim は無効。
  - `crx/sidepanel/write.html` および `read.html` に `<script src="../scripts/storage-shim.js"></script>` を追加（module より前）。
  - `cli/cli.js`: `chira serve` に `crx/` ディレクトリ配下の静的ファイル配信機能を追加（MIMEタイプ判定、パストラバーサル防止）。`http://127.0.0.1:8787/sidepanel/write.html` でブラウザから開けるようにした。
  - `test/storage-shim.test.js` および `test/serve.test.js` を追加し、Node.js 組み込みテスト（node --test）および実ブラウザでの保存・リロードを検証。

## 2026-11-04 / v0.1.7-dev — 入口1は crx の HTML をローカル起動（オフラインメモ）

- 指示: crx の HTML をローカルで起動してオフラインメモにする。
- 変更: `dev/cloud-design.md` に §4.5 を追加（設計のみ）。入口1を「新規 PWA」から「既存 crx HTML の localhost 起動」に差し替え。
  - 実コード調査: write/read ページの chrome.* 依存は chrome.storage.local（get/set/onChanged、キー notes / activeNoteId / autoSave）のみ。他は background 側
  - ES module のため file:// では動かない → `chira serve`（127.0.0.1:8787）が crx/ を静的配信し、`http://127.0.0.1:8787/sidepanel/write.html` を開く
  - storage shim（localStorage 裏の互換層）を1枚足せば拡張なし・オフラインで書ける。localStorage は下書き置き場で正ではない
  - 未決定に追加: localStorage から先（SQLite / CF）の取り込み経路

## 2026-11-04 / v0.1.6-dev — クラウド化の設計（CF / wiki / MCP）

- 指示: chira-ura をデスクトップ／モバイルから使う。保存は REST API でクラウドへ自動で。保存先は Cloudflare（FE API＋仮保存のみ）と GitHub bonsai/wiki/raw（正）。オフラインでも書き、復帰したらまとめて push。pi-coding からは MCP で使う。設計まで Muse、実装はローカル、デプロイは CF。
- 変更: 統合設計書 `dev/cloud-design.md` を追加（設計のみ、実装は未着手）。
  - 定義: インプットは4種類（PWA / crx / CLI / API）、DBの正はひとつ（bonsai/wiki）。形式はメモ JSON 1つ
  - リズム: ローカル即保存 → 1分毎に CF キャッシュへ送信（タイムスタンプ名、新規ファイル）→ 書き終わったら 1時間毎に wiki/raw へ 1コミット
  - CF の役割は FE API 提供と仮保存のみ（Workers + KV + Cron）。Keep は保存先にしない（API が無い、Takeout 取り込みのみ）
  - 後半生: wiki で寝かせる → 読み込んで検討 → 思い出す → つなげる（weave / orochi 式 Issue 化）
  - MCP: FE API と同じ Worker の `/mcp`。書く側はキャッシュ止まり、読む側は wiki 読み取り専用
- 未決定: ファイル拡張子（.txt 推奨）、読み戻しの定期便、Worker 名

## 2026-10-22 / v0.1.5-dev — NEW は書くページだけ

- 指示: popup に「＋」は不要。新規作成ボタンは「書く」ページだけに置く。
- 変更: `crx/sidepanel/write.html` に `＋ NEW` を追加。押すと空の編集状態になり、書き始めると別メモとして保存する。既存メモは保持。
- popup は従来どおり「箱 / 読む / 書く」のみ。


## 2026-10-22 / v0.1.4-dev — CLI に SQLite（~/.chira/ura.db）。拡張と同じ JSON

- 指示: make cli（Windows で `chira` が動くように）/ make .chira/ura.db / make cli by js and json as same as crx。
- 変更:
  - `cli/install.ps1`（Windows 版インストール。`~/.local/bin/chira.cmd` を PATH へ）と `cli/install.sh`（POSIX）。
  - `cli/ura-db.js`（node:sqlite。メモの正 JSON を `~/.chira/ura.db` に持つ。journal=DELETE で 1 ファイル完結 → 端末間では .db をそのままコピーできる）。
  - `crx/scripts/model.js`（メモの型。拡張と CLI が共用。deriveTitle / parseJsonl / toJsonl / DB_SCHEMA）。
  - CLI: `chira db path|init|export|import` / `chira notes` / `chira note add|get|rm` /
    `chira export|import`（JSONL＝箱のファイル形式）/ `chira storage export|import`（chrome.storage.local 相当）。
  - canonical の出力は sync-db と同じ形（schema.sql + <table>.jsonl）。同じ .db を端末間でやり取りできる。
  - `crx/sidepanel/write.js` と `crx/popup/app.js` は model.js を使うようにした（挙動は同じ）。
  - `dev/chira-ura.puml`（構成図 5 枚。plantuml.jar は ~/.crx に置く）。
- 未実施: 拡張 ↔ SQLite の自動同期（今は JSONL / canonical 経由の受け渡し）。

## 2026-10-19 / v0.1.3-dev — CLI を OAuth 経由に

- 指示: cli スキル oauth に経由して / box フォルダ / アカウント。
- 変更: `chira auth`（PKCE + ループバック 127.0.0.1:8799）→ `~/.config/chira-ura/token.json`（0600）。
  `chira token`（期限切れは refresh）/ `chira logout`。CLI は拡張と同じ `client_id`（manifest か `oauth.clientId`）を使う。
  `cli/sync.sh` は読込先を `CHIRA_LOAD_DIR` → `~/.crx` → `/mnt/*/Users/*/.crx` の順で自動検出（個人パスを書かない）。
  ローカル keys.json に gdrive.folder / folderId / account / gh.account を設定（repo には入れない）。

## 2026-10-19 / v0.1.2-dev — 箱を CLI から指定 / OAuth を飛ばす / CLI を PATH へ

- 指示: cli から設定して箱を指定したい。cli スキル。oauth で飛ばして。
- 変更: `chira box` を引数なしで現在値表示に（`chira box gh` で設定 → keys.json → ブリッジ → 拡張が pull）。
  `cli/install.sh` で `~/.local/bin/chira` に symlink（skill から `chira` を直接叩ける）。
  箱選択は 1 度目に無言トークン（同意画面を飛ばす）、同じ箱の 2 度押しで同意画面。
  flash の未使用キー（box / gas）と popup CSS の未使用 `.badge` を削除。

## 2026-10-19 / v0.1.1-dev — popup を 3 コマンド + ver/ロゴに

- 指示: 箱を設定する（選択肢は OAuth / cli.js）、自動同期トグル、読む、書く、hr、ver0.1.0 とロゴ。
  ver は履歴リンク、ロゴは https://bonsai.github.io/chira-ura/ 、イシューリンクは無し。
- 変更: popup = 箱を設定する（右に自動同期 switch）/ 読む / 書く。`hr.rule` の下に `ver <version_name>`（→ dev/dev.history.md）
  とロゴ（→ サイト）。イシュー/履歴コマンドを削除。箱パネルの鍵行は「cli.js」表記に。
  background は `autoSync` が false のとき pull しない。

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
