# モバイルクライアント設計（iOS 
/ Android）

対象: `mob/iphone/`（iOS）,
 `mob/apk/`（Android）。状態: **計画**
（未実装）。

## 思想
「DB はひと
つ、UI は多様に」。入口（UI）は�
��やしてよいが、正と保存形式は�
��通にする。

- 保存形式: メモ JSO
N `{ id, title, content, updatedAt }`（crx /
 cli / win / rust と同じ）。
- 同期先
: FE API（`api/`）。書き込みは `PUT /
inbox/<name>` に `{ content, updatedAt, clos
ed }`。
- 送信は疎結合: 端末はロ�
�カル保存に専念し、送信は CLI / W
orker に寄せてよい。

## 共通要件

1. **オフライン優先**: ネット無し
でも即保存（タイムスタンプ順で
ためる）。
2. **オンライン復帰で
まとめて送信**: 未送信分を小分�
�（既定 10 件）で送る。各バッチ 
= 1 コミット（`bonsai/wiki/raw/<MM>/` �
� CLI 側の役割）。
3. **冪等**: 送�
�済みは再送しない（`sync.inbox` / `s
ync.wiki` 相当のメタで管理）。
4. *
*爆速**: 起動 → 入力可能が最短�
�常駐はしない。
5. **日本語入力**
を既定で有効（IME を明示）。

## 
送信経路（既存と同じ）
```
端末�
��ーカル（JSON / SQLite 相当）
  └�
� 未送信 → PUT /inbox/<name>（FE API, a
pi/）
                └─ 毎時バッチ
 → bonsai/wiki raw/（api cron）
  また�
��
  └─ chira wiki（CLI, 10 件ずつ 1 
コミット）で bonsai/wiki raw/
```

## �
��術選定（未定・候補）
| 案 | iOS 
| Android | 備考 |
|---|---|---|---|
| ネ�
��ティブ | SwiftUI | Kotlin / Jetpack Comp
ose | 起動・入力が最速。実装は二
重 |
| クロス | .NET MAUI | .NET MAUI | C
#（`gui/win` と知見共有） |
| クロ�
� | Flutter | Flutter | 単一コードベー
ス |

判定は「起動→入力可能」�
�実測で。ADR-001 の流儀（測って決
める）に従う。

## ディレクトリ

```
gui/
├── rust/     Rust egui（WSL/
Unix/Windows） 実装済み
├── win/  
    C#/.NET WinForms（chira.exe） 実装済
み
├── iphone/   iOS（これ）
└�
�─ apk/      Android（これ）
```

## �
�け入れ条件（最小）
- [ ] オフラ�
��ンで新規メモを即保存できる
- [
 ] オンライン復帰で未送信分がま
とめて `PUT /inbox` に届く
- [ ] 再実
行しても重複しない（冪等）
- [ ]
 起動→入力可能が体感で速い（�
�安 < 300ms）
- [ ] 日本語入力が既�
�で使える

## 非目標
- 整理・検索
・読み戻しの作り込み（後段はチ
ャット / Muse 側）。
- 常駐・バッ�
��グラウンド同期の作り込み（ま�
��は手動 / 起動時）。

## 参照
- `a
pi/src/index.js`（FE API 契約）, `api/src
/mcp.js`
- `cli/wiki-push.js`（10 件ずつ 
wiki へ）
- `gui/win/ChiraUra.Core/SyncServ
ice.cs`（オフライン保存 → 送信の
参考）
- ADR-001（`dev/adr-001-rs-vs-cs.m
d`）


