# gui/iphone — iOS クライアント（SwiftUI）

iOS 向け付箋メモクライアント（ChiraUra）。

## 概要

`dev/mobile-design.md` および ADR-001 の流儀に従い、SwiftUI + URLSession + NWPathMonitor による爆速・オフライン優先の iOS クライアント。

- 最低動作要件: iOS 16.0+（SwiftData 導入 iOS 17+ に対応したストレージ設計）
- 保存形式: メモ JSON `{ id, title, content, updatedAt }`（crx / CLI / win / rust / apk と互換）
- 送信先: FE API（`api/`）— `PUT /inbox/<name>` に `{ content, updatedAt, closed }`
- 認証: `Authorization: Bearer <token>` または `X-Chira-Token: <token>`
- オフライン優先: ネットワーク未接続時も即座にローカルへ保存し、outbox キューに保持
- オンライン復帰: 未送信分を小分け（既定 10 件ずつ）で送信し、送信完了時に削除（冪等）
- 爆速起動: 起動からエディタへの自動フォーカスまで < 300ms を目標とし、日本語入力を標準でサポート

## プロジェクト構成

```
gui/iphone/
├── ChiraUra.xcodeproj/
│   └── project.pbxproj        # Xcode プロジェクトファイル
├── ChiraUra/
│   ├── ChiraUraApp.swift      # アプリケーションエントリポイント
│   ├── Info.plist             # Bundle / Info 設定
│   ├── Models/
│   │   ├── Note.swift         # Note 型・InboxPayload・タイトル導出
│   │   └── OutboxItem.swift   # 未送信 outbox キューモデル
│   ├── Storage/
│   │   └── NoteStore.swift    # ローカル永続化（Application Support / JSON）
│   ├── Network/
│   │   ├── ChiraApiClient.swift # PUT /inbox/<name> 送信クライアント
│   │   └── NetworkMonitor.swift # NWPathMonitor によるオンライン/オフライン検知
│   ├── Sync/
│   │   └── SyncService.swift  # 10件バッチ送信・冪等リトライ
│   └── Views/
│       ├── StickyNoteView.swift # 付箋 UI（📝 ｜ ＋ ｜ ☁️）
│       └── SettingsView.swift # FE API 設定（URL / Token）
└── ChiraUraTests/
    ├── NoteTests.swift        # JSON 互換性・タイトル導出テスト
    └── SyncServiceTests.swift # 10件バッチ・冪等性・オフラインフォールバックテスト
```

## ビルド方法

### Xcode（GUI）
1. macOS で Xcode 15+ を開く
2. `gui/iphone/ChiraUra.xcodeproj` を開く
3. ターゲットに `ChiraUra`、実行先に対象シミュレータ（例: iPhone 15）または実機を選択
4. `Cmd + R` で実行、`Cmd + U` でテスト実行

### xcodebuild（CLI）

```bash
# ユニットテスト実行
xcodebuild test \
  -project gui/iphone/ChiraUra.xcodeproj \
  -scheme ChiraUra \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO

# Debug ビルド (.app の生成)
xcodebuild build \
  -project gui/iphone/ChiraUra.xcodeproj \
  -scheme ChiraUra \
  -configuration Debug \
  -sdk iphonesimulator \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO
```

### 実機インストール用 .ipa（Debug / Ad-Hoc 署名）

```bash
# Archive 生成
xcodebuild archive \
  -project gui/iphone/ChiraUra.xcodeproj \
  -scheme ChiraUra \
  -configuration Debug \
  -archivePath build/ChiraUra.xcarchive \
  CODE_SIGNING_ALLOWED=NO

# 実機署名が必要な場合:
# Xcode の「Signing & Capabilities」でご自身の Apple Developer Account / 開発用プロファイルを指定してください。
```

## UI と操作

- **画面全体**: 黄色付箋風の背景。起動時に即テキスト入力フォーカスが当たり、すぐに書き始められます。
- **フッター（三等分）**:
  - `📝 保存`: 現在の内容をローカル保存し、オンラインであれば FE API に送信。
  - `＋ 新規`: 現在の内容を保存（closed）して白紙の付箋を開く。
  - `☁️ 送信`: 未送信 outbox を即時フラッシュ（10 件ずつ送信）。
- **ステータス表示**:
  - `📝 白紙` / `✏️ 編集中` / `💾 ローカル保存済` / `☁️ 送信完了`
