# チラ裏エコシステム設計書 — クラウド化（CF / wiki / MCP）

版: v0.1.7-dev 設計 / 日付: 2026-11-04
分担: **設計は Muse（この文書まで）。実装はローカル（pi-coding / CLI）。デプロイ先は Cloudflare。**
この文書が正。チャット側の検討文書（定義・解説）はこの文書に統合済み。

## 1. 定義

チラ裏エコシステムとは、思いついた瞬間にどこからでも書き殴れる4つの入口を持ち、書いたものは段階的に1か所（bonsai/wiki）へ集まり、そこで寝かせ、後から読み戻して検討し、思い出し、つなげるための、メモとアイデアの循環系である。

- 前半生（書く〜集める）: chira-ura が担う。速さと軽さがすべて
- 後半生（寝かせる〜つなげる）: wiki と Muse が担う。深さと連結がすべて
- 境目は「正への到着」。正に届く前は下書き、届いた後が素材

## 2. 原則（5つ）

1. **インプットは4種類、DBの正はひとつ**
   入口: ローカルページ（crx HTML 兼用）/ crx / CLI / API。正（最終的に正しいとみなす DB）は bonsai/wiki ただ1か所。他（CF キャッシュ、端末ローカル、SQLite）はすべて写し・下書き・中継で、消えても正から作り直せる。正本を二重化しない
2. **形式は1つ**: 全入口が同じメモ JSON `{id, title, content, updatedAt}` を使う。title は本文1行目から導出（`crx/scripts/model.js` 共用）
3. **書く時は考えない**: 捕捉は ultra_minimal。分類・整理・連結を書く画面に持ち込まない。コピーは本文のみ
4. **raw は生のまま寝かせる**: 正に入ったファイルは書き換えて整理しない。整理とは、正を読んで新しい連結（entries / ideas / リンク / Issue）を作ること
5. **秘密は repo に置かない**: 認証はトークン／OAuth のみ。実値は CF の secret と端末ローカル設定だけに置く

## 3. 構成と役割

| 要素 | 役割 | 実体 |
|---|---|---|
| ローカルページ | 入口1: PC で白紙に書き殴る（オフライン） | crx の sidepanel HTML をそのまま localhost で開く（§4.5）。別途 PWA は作らない |
| crx | 入口2: ブラウザ作業中のメモ | 既存の Chrome 拡張サイドパネル |
| CLI | 入口3: ターミナル／スクリプト | 既存の `chira`（SQLite は下書き置き場） |
| API | 入口4: プログラム／エージェント | CF Workers の FE API |
| MCP | 入口4のエージェント用フェイス＋読み側の道具 | FE API と同じ Worker の `/mcp`（§7） |
| Cloudflare | FE API 提供＋仮保存（キャッシュ）のみ。正にはしない | Workers + KV、Cron Triggers |
| GitHub bonsai/wiki | 唯一の正。寝かせる場所 | private / master / `raw/<MM>/` |
| Muse / pi-coding | 実装（ローカル）と、読む者・つなぐ者 | wiki を読み検討し、必要なら Issue 化（orochi 式） |

## 4. リズム（前半生）

```
書く（常時・ローカルへ即保存、オフライン可）
  → 1分毎: 変更分を CF キャッシュへ送信（同名上書き、全文化）
  → 溜まる: 閉じたファイルがキャッシュ（KV、キー=ファイル名）に蓄積
  → 1時間毎: Cron が閉じた全件を bonsai/wiki/raw/<MM>/ へ 1コミットで push し、キャッシュから消す
```

- ファイルはセッション毎に新規作成。名はタイムスタンプ `YYYYMMDD_HHMMSS.txt`（wiki/raw の既存命名 `無題N_YYYYMMDD_HHMMSS.txt` と同型）
- 「閉じた」判定: 新規開始／ページを閉じた（sendBeacon）／10分無更新 のいずれか
- 書き込みは 下書き → キャッシュ → 正 の一方通行。失敗時はキャッシュに残し翌時リトライ（同名上書きで冪等）
- オフライン時: ローカルに積むだけ。復帰後に 1分送信が再開し、遅れて正へ届く

## 4.5 ローカル起動（オフラインメモ）

入口1の実体。新規に PWA を作らず、**既存の crx の HTML（`crx/sidepanel/write.html` / `read.html`）をローカルでそのまま開いて**オフラインメモとして使う。同じ HTML が「拡張のサイドパネル」と「ローカルページ」の2つの顔を持つ。

実コード調査（2026-11-04、main 実物）で確認した前提:

- 書く／読むページの `chrome.*` 依存は **`chrome.storage.local`（get / set / onChanged）だけ**。他 API は background 側のみ
- 使うキーは `notes` / `activeNoteId` / `autoSave` の3つ。値の形式はメモ JSON そのまま（model.js の契約通り）
- JS は相対 import の ES module。**`file://` では module の CORS で動かない** → 必ず `http://localhost` で開く（localhost は secure context なので clipboard も効く）

必要な実装は2点だけ:

1. **storage shim**（`crx/scripts/storage-shim.js`、module より前に読み込む通常スクリプト）: `chrome.storage` が無い環境では、同名キーで **localStorage を裏に持つ互換オブジェクト**を `window.chrome.storage.local` として差し込む。`onChanged` は同一ページ内の set では自前で発火、他タブとは `storage` イベントで同期。拡張環境では何もしない（実物が優先）
2. **静的配信**: `chira serve`（既存、127.0.0.1:8787 — host_permissions 済み）が `crx/` を静的配信する。開く URL は `http://127.0.0.1:8787/sidepanel/write.html`

この形の性質:

- オフラインでも localhost と localStorage は動く → 捕捉は常時可能。**localStorage は下書き置き場（outbox）であり、正ではない**（原則1）
- モバイルはこの形では賄わない。モバイル入口が要る段階で、同じ HTML + shim を CF から配信すればそのままブラウザで開ける（配信元が違うだけで中身は同一）。作るかどうかは未決定のまま残す
- ローカルページの localStorage から先（SQLite 取り込み／CF 送信）の経路は §10 の未決定4

## 5. FE API（Cloudflare Workers）

認証: `Authorization: Bearer` または `X-Chira-Token` ヘッダ（trailme と同型）。実値は `wrangler secret put`。

| メソッド | パス | 意味 |
|---|---|---|
| PUT | `/inbox/<name>` | 1分毎の送信先。body: 本文 + `updatedAt` + `closed`。KV に同名上書き |
| GET | `/inbox` | キャッシュ一覧（名前・タイトル・更新時刻） |
| GET | `/count` | 件数と最終受信（死活確認用） |
| Cron | 毎時 | closed 全件 → GitHub API で bonsai/wiki へ 1コミット → 成功分を KV から削除 |

- Worker コード配置: `worker/`（`worker/src/index.js`, `worker/wrangler.json`, `worker/package.json`）
- トークン設定手順（実値は repo に含めない）:
  ```bash
  # Worker ディレクトリでシークレットを登録
  cd worker
  npx wrangler secret put CHIRA_TOKEN
  # プロンプトでトークン値を入力
  ```
- GitHub トークンは Worker の secret にのみ置く（fine-grained、対象は bonsai/wiki のみ）
- KV の TTL は 7日目安。正は wiki とローカルなので、キャッシュが消えても復旧可能

## 6. 後半生（寝かせる → つなげる）

```
寝かせる（wiki/raw に生のまま）
  → 読み込んで検討する（Muse が wiki から読む。場所はチャット）
  → 思い出す（関連する古いメモも一緒に引き上げる）
  → つなげる（entries / ideas / concepts へ織る。形になれば orochi 式に Issue 化）
```

- ローカルページ / crx に読み戻し・整理機能は足さない（原則3）
- トリガーは当面手動（チャットで呼ぶ）。定期便は未決定

## 7. MCP（pi-coding 連携）

- pi-coding（TOY 上の Pi エージェント）にチラ裏を MCP サーバーとして登録する。コーディング中の捕捉と、寝かせたメモの読み戻しをエージェントの道具にする
- トランスポート: Streamable HTTP `https://<worker>/mcp`（FE API と同じ Worker）。stdio が要る場合は REST 中継の薄いブリッジを TOY に置く
- ツール（名前は `chira_` 接頭辞、vrma2video MCP の先例に倣う）:
  - 書く側（キャッシュ止まり）: `chira_note_add(content)` / `chira_inbox_list` / `chira_count`
  - 読む側（wiki 読み取り専用）: `chira_wiki_list_raw(month?)` / `chira_wiki_read(path)` / `chira_wiki_search(query)`
- MCP からも正へ直接書かない。書き込み口は時間毎バッチの1本だけ（原則1）
- 登録時に pi-coding 側へ渡すのは URL とトークン（環境変数 `CHIRA_TOKEN`）の2点のみ

## 8. 境界（この設計ではないもの）

- Google Keep への保存（一般向け API が無い。Takeout 取り込み元のみ — 既存 Issue #1）
- CF や Google Drive を正にする構成（Drive は旧来の箱の選択肢として残るのみ）
- リアルタイム共同編集、複数人同時書き込み
- メモを直接 Issue／成果物にすること（必ず「寝かせる→検討」を経る）

## 9. 実装ステップ（ローカル側）

1. Worker: FE API（§5）+ KV + Cron（時間毎 push）を実装し Cloudflare へデプロイ。secret 2点（API トークン、GitHub トークン）を投入
2. ローカル起動: storage shim（§4.5）を実装し、`chira serve` に `crx/` の静的配信を足す。拡張なし・オフラインで write.html が書けることを確認する（入口1の完成はここまで）
3. crx: 既存 sidepanel の保存に加え、1分送信を `/inbox` へ向ける（現行の localhost ブリッジ pull は置き換え）
4. CLI: `chira sync`（ローカル DB の未送信分を `/inbox` へ送る）を追加
5. MCP: `/mcp` と §7 のツールを実装し、pi-coding に登録して通し確認

## 10. 未決定

1. ファイル拡張子: `.txt`（推奨、本書の前提）/ `.md`
2. 読み戻しの定期便を持つかどうか
3. Worker 名・KV namespace 名（デプロイ時に確定し、repo には書かない運用でも可）
4. ローカルページ（§4.5）の localStorage から先の経路: `chira serve` が POST で受けて SQLite へ入れる / export・import で寄せる / CF へ直接送る（§5 の送信をブラウザから行う）
