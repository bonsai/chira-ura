# pi-coding へのチラ裏 MCP サーバー登録手順

設計: `dev/cloud-design.md` §7。
pi-coding（TOY 上の Pi エージェント）にチラ裏を MCP サーバーとして登録し、コーディング中のメモ捕捉と、寝かせたメモの読み戻しを可能にします。

## 渡す設定情報（2点のみ）

pi-coding に設定するのは以下の **2点** です（トークン等の実値はリポジトリにコミットしないこと）:

1. **MCP Endpoint URL**: `https://<your-worker-subdomain>.workers.dev/mcp`
2. **認証トークン（環境変数 `CHIRA_TOKEN`）**: Worker に設定した `API_TOKEN` と同一の文字列

---

## 設定例

### 1. 環境変数の設定

シェルまたは `.env`（秘密情報として管理）で環境変数を設定:

```bash
export CHIRA_TOKEN="<your-token>"
```

### 2. pi-coding / MCP クライアント設定（Streamable HTTP）

pi-coding の設定ファイル（例: `~/.config/pi-coding/mcp.json` またはクライアントの MCP 設定）に以下を追加します:

```json
{
  "mcpServers": {
    "chira": {
      "url": "https://<your-worker-subdomain>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${CHIRA_TOKEN}"
      }
    }
  }
}
```

※ `headers` には `X-Chira-Token: "${CHIRA_TOKEN}"` を使用することも可能です。

---

## 提供ツール一覧

チラ裏の MCP サーバーは「原則1: DBの正はひとつ（bonsai/wiki）」に基づき、書く側はキャッシュ止まり、読む側は wiki 読み取り専用で構成されています。

### 書く側（キャッシュ止まり、正へ直接書かない）

| ツール名 | 引数 | 説明 |
|---|---|---|
| `chira_note_add` | `content: string` | inbox キャッシュ（KV）へメモを未終了（closed: false）として保存。タイムスタンプ名 `YYYYMMDD_HHMMSS.txt` が付与される。 |
| `chira_inbox_list` | なし | 現在 inbox キャッシュ（KV）に溜まっているメモの一覧（name, title, updatedAt, closed）を取得。 |
| `chira_count` | なし | inbox キャッシュ（KV）内のメモ件数と最終受信日時を取得。 |

### 読む側（wiki 読み取り専用）

| ツール名 | 引数 | 説明 |
|---|---|---|
| `chira_wiki_list_raw` | `month?: string` | `bonsai/wiki` の master ブランチに保存された `raw/` 以下のファイル一覧を取得（例: `month: "04"` で `raw/04/` に絞り込み）。 |
| `chira_wiki_read` | `path: string` | `bonsai/wiki` 内の指定パス（例: `raw/04/20260415_120000.txt`）のメモ全文を取得。 |
| `chira_wiki_search` | `query: string` | `bonsai/wiki` の `raw/` ディレクトリ内のメモをキーワード検索し、マッチしたファイルと該当スニペットを返却。 |

---

## 動作確認

1. **書く**: `chira_note_add("検証用メモ: pi-coding から送信")`
   - 返り値として `{ "ok": true, "name": "YYYYMMDD_HHMMSS.txt", ... }` が返り、inbox に入ることを確認。
2. **一覧**: `chira_inbox_list()` で追加されたメモが存在することを確認。
3. **読む / 検索**: `chira_wiki_search("...")` で過去の wiki/raw メモが引けることを確認。
