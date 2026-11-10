# モバイルクライアント設計（iOS / Android）

対象: `gui/iphone/`（iOS）, `gui/apk/`（Android）。状態: **実装済み**（`gui/mobile` / Flutter）。

## 思想
「DB はひとつ、UI は多様に」。入口（UI）は増やしてよいが、正と保存形式は共通にする。

- 保存形式: メモ JSON `{ id, title, content, updatedAt }`（crx / cli / win / rust と同じ）。
- 同期先: FE API（`api/`）。書き込みは `PUT /inbox/<name>` に `{ content, updatedAt, closed }`。
- 送信は疎結合: 端末はローカル保存に専念し、送信は CLI / Worker に寄せてよい。

## 共通要件
1. **オフライン優先**: ネット無しでも即保存（タイムスタンプ順でためる）。
2. **オンライン復帰でまとめて送信**: 未送信分を小分け（既定 10 件）で送る。各バッチ = 1 コミット（`bonsai/wiki/raw/<MM>/` は CLI 側の役割）。
3. **冪等**: 送信済みは再送しない（`sync.inbox` / `sync.wiki` 相当のメタで管理）。
4. **爆速**: 起動 → 入力可能が最短。常駐はしない。
5. **日本語入力**を既定で有効（IME を明示）。

## 送信経路（既存と同じ）
```
端末ローカル（JSON / SQLite 相当）
  └─ 未送信 → PUT /inbox/<name>（FE API, api/）
                └─ 毎時バッチ → bonsai/wiki raw/（api cron）
  または
  └─ chira wiki（CLI, 10 件ずつ 1 コミット）で bonsai/wiki raw/
```

## 技術選定（未定・候補）
| 案 | iOS | Android | 備考 |
|---|---|---|---|
| ネイティブ | SwiftUI | Kotlin / Jetpack Compose | 起動・入力が最速。実装は二重 |
| クロス | .NET MAUI | .NET MAUI | C#（`gui/win` と知見共有） |
| クロス | Flutter | Flutter | 単一コードベース |

判定は「起動→入力可能」の実測で。ADR-001 の流儀（測って決める）に従う。

## ディレクトリ
```
gui/
├── rust/     Rust egui（WSL/Unix/Windows） 実装済み
├── win/      C#/.NET WinForms（chira.exe） 実装済み
├── iphone/   iOS（これ）
└── apk/      Android（これ）
```

## 受け入れ条件（最小）
- [x] オフラインで新規メモを即保存できる
- [x] オンライン復帰で未送信分がまとめて `PUT /inbox` に届く
- [x] 再実行しても重複しない（冪等）
- [x] 起動→入力可能が体感で速い（目安 < 300ms）
- [x] 日本語入力が既定で使える

## 非目標
- 整理・検索・読み戻しの作り込み（後段はチャット / Muse 側）。
- 常駐・バックグラウンド同期の作り込み（まずは手動 / 起動時）。

## 参照
- `api/src/index.js`（FE API 契約）, `api/src/mcp.js`
- `cli/wiki-push.js`（10 件ずつ wiki へ）
- `gui/win/ChiraUra.Core/SyncService.cs`（オフライン保存 → 送信の参考）
- ADR-001（`dev/adr-001-rs-vs-cs.md`）
