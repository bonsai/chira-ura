# mob/ — モバイルクライアント

chira-ura のモバイルクライアントをプラットフォームごとに配置する。

| ディレクトリ | 技術 | 対象 | 状態 |
|---|---|---|---|
| `mobile/` | Flutter (Dart) | iOS + Android | 実装済み (PR #47) |
| `iphone/` | SwiftUI | iOS | superseded by mobile/ |
| `apk/` | Kotlin + Compose | Android | superseded by mobile/ |

- 共通の FE API 契約は `api/`（Cloudflare Worker）を参照。書き込みは `PUT /inbox/<name>` に `{ content, updatedAt, closed }`。
- 保存形式はメモ JSON `{ id, title, content, updatedAt }`（crx / cli / win / rust と同じ）。