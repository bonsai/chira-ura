# gui/ — プラットフォーム別 GUI �
�ライアント

chira-ura の GUI クライ
アントをプラットフォームごとに
配置する。

| ディレクトリ | 言�
� / 技術 | 対象 | 状態 |
|---|---|---|-
--|
| `rust/` | Rust（egui + eframe） | WSL
 / Unix / Windows | 実装済み |
| `win/` |
 C# / .NET（WinForms） | Windows | PR #21 |

| `mob/iphone/` \| TBD \| iOS \| 計画（`mob/` 配下へ移行） \|
| `mob/apk/` | TBD | Android | 計画（`mob/` 配下へ移行） |

- 方針は **ADR
-001**（`dev/adr-001-rs-vs-cs.md`）: Rust �
��第一候補、C# をフォールバック�
��
- 共通の FE API 契約は `api/`（Clou
dflare Worker）を参照。書き込みは `
PUT /inbox/<name>` に `{ content, updatedAt,
 closed }`。


