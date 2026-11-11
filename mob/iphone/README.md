# mob/iphone — iOS クライアント（実装済み）

iOS 向け付箋メモクライアント（Flutter / `mob/mobile`）。

- FE API: `api/`（`PUT /inbox/<name>` に `{ content, updatedAt, closed }`）
- 保存形式: メモ JSON `{ id, title, content, updatedAt }`
- オフライン優先: ローカル outbox に保存し、オンライン復帰時に 10 件ずつ送信
- 日本語入力: IME 最適化、起動即入力フォーカス

## ビルド

```bash
bash mob/iphone/build.sh
# または mob/mobile ディレクトリから
cd mob/mobile && flutter build ios --no-codesign
```
