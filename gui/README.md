# gui/ — プラットフォーム別 GUI クライアント

chira-ura の GUI クライアントをプラットフォームごとに配置する。

| ディレクトリ | 言語 / 技術 | 対象 | 状態 |
|---|---|---|---|
| `rust/` | Rust（egui + eframe） | WSL / Unix / Windows | 実装済み |
| `win/` | C# / .NET（WinForms） | Windows | PR #21 |
| `iphone/` | Flutter (`gui/mobile`) | iOS | 実装済み |
| `apk/` | Flutter (`gui/mobile`) | Android | 実装済み |

- 方針は **ADR-001**（`dev/adr-001-rs-vs-cs.md`）: Rust を第一候補、C# をフォールバック。
- 共通の FE API 契約は `api/`（Cloudflare Worker）を参照。書き込みは `PUT /inbox/<name>` に `{ content, updatedAt, closed }`。
