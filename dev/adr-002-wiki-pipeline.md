# ADR-002: wiki push 前の整形 / 埋め込みのパイプライン設計（raw 不変・weaver/rag 分離）

- 状態: **Accepted** — 2026-11-06 決定
- 対象: `bonsai/chira-ura`（CLI `chira wiki` / API cron `wiki-push`）、`bonsai/wiki`、`bonsai/weaver`、`bonsai/rag`
- 関連: `dev/layers.md`, `dev/layers.mmd`, `cli/wiki-push.js`, `api/src/wiki-push.js`

---

## 1. 背景と課題

現在 `chira-ura` では、オフラインで蓄積されたメモ（SQLite `~/.chira/ura.db` または KV `INBOX`）を `chira wiki` CLI または Worker cron により 10 件ずつ 1 コミットにまとめ、`bonsai/wiki` の `raw/<MM>/<ts>_<id>.txt` へ push している。

ここで以下の問いが生じた：
1. **送信前整形（正規化・タグ付け・構造化）を行うべきか？**
   - 送る前にローカル LLM（1M トークン級のバッチ）でまとめて整形するか。
   - 「pain（課題・苦痛）のメモ → アイデア / 作業 / 目的 / 実装」へ構造化するプロンプトをどう設計するか。
2. **埋め込み（embedding）をどこで行うべきか？**
   - LM Studio などのローカル環境で embedding してから wiki へ送るか、それとも wiki 側（rag レイヤ）で生成するか。
3. **生メモ不変（raw はそのまま）と別レイヤ（weaver / rag）に置く三層アーキテクチャとの整合性をどう保つか？**

---

## 2. 決定（Decision）

### 決定事項 1: 送信前整形は「行わない」（chira-ura は raw のまま送る）
- `chira-ura`（dump レイヤ）の責務は **「生メモをそのまま最速・確実に `bonsai/wiki/raw/` へ届けること」** に限定する。
- メモ送信パイプラインの中に同期的な LLM 整形（正規化・構造化・タグ付け）を挟まない。
- `bonsai/wiki` の `raw/<MM>/` は **完全不変（immutable append-only）** とする。

### 決定事項 2: 整形・構造化は `weaver`（`bonsai/weaver`）が担う
- 構造化（pain → アイデア / 作業 / 目的 / 実装）やクリエイティブな再構成・タグ付けは、下流の醸成レイヤ `weaver` が非同期バッチで実施する。
- weaver は `wiki/raw/` を読み込み、構造化・醸成した結果を `wiki/ripe/<YYYY>/<slug>.md` に出力し、必ず元の生メモへの参照メタデータ（トレーサビリティ）を保持する。

### 決定事項 3: 埋め込み（Embedding）は `rag`（`bonsai/rag`）が担う
- `chira-ura` や `wiki` の push 時に embedding を生成・付与しない。
- embedding は、構造化・醸成された `wiki/ripe/` を索引化する `bonsai/rag` 側が担当する。

---

## 3. 決定の根拠（Rationale）

| 観点 | 送信前に整形・埋め込みする場合 | 送信前は raw そのまま（採択方針） |
|---|---|---|
| **dump の本質（速さ・オフライン）** | ✕ 送信時に LLM 推論や LM Studio の稼働を要求し、オフライン・低スペック端末で詰まる。送信遅延が生じる。 | ◎ **速さが全て**。ネットワーク疎通時に即時バッチ push 完了。ローカル LLM 不要でどこでも動く。 |
| **一次情報の完全性（可逆性）** | ✕ 一度 LLM で整形・要約されたものを raw とすると、書き殴りの生々しい文脈・ニュアンス・誤字に含まれる思考過程が永久欠損する。 | ◎ **raw は不変**。思考の一次記録が 100% 残る。将来モデルが進化しても過去の全 raw を再解釈・再 weaver できる。 |
| **三層アーキテクチャの関心の分離** | ✕ `chira-ura`（dump）に LLM 生成（weaver）とベクトル化（rag）が混入し、疎結合の原則が崩れる。 | ◎ **三層（dump / weaver / rag）の境界が明確**。各層が独立してスケール・差し替え可能。 |
| **計算リソースと実行タイミング** | ✕ メモ送信の都度 1M トークン処理や embedding を呼ぶとリソース消費が過大。 | ◎ weaver は別ホスト（GPU マシンやバッチ定期ジョブ）で夜間・アイドル時に 1M トークン級でまとめて醸成可能。 |

---

## 4. 整形プロンプト設計（weaver レイヤ用仕様）

weaver が `wiki/raw/` から読み込み、「pain（課題・苦痛）のメモ → アイデア / 作業 / 目的 / 実装」へ構造化するための標準プロンプト仕様。

### 4.1 プロンプト設計仕様

```markdown
# Role & Goal
あなたは生メモ（書き殴り・断片）から本質的な課題・目的を洞察し、具体的かつ実装可能な形へ再構成する醸成エージェント「weaver（織姫）」です。

# Input
- 期間内の複数の raw メモ群（パス、タイムスタンプ、本文）

# 構造化ルール
各メモまたはクラスタ化されたトピックごとに、以下の 4 要素へ構造化してください：
1. **pain（課題・違和感・苦痛）**:
   - 筆者が何に引っかかり、何に困っていたのか。生の声・背景を抽出。
2. **目的（Why / Outcome）**:
   - その pain を解消することで達成したい本質的な状態・価値。
3. **アイデア（Core Idea）**:
   - 解決のための着想、切り口、直感的なアプローチ。
4. **作業 / 実装（How / Action Items）**:
   - 具体的に何を作るか、どのようなステップで進めるか。

# 出力形式
Markdown 形式（YAML frontmatter 必須）：

---
title: "<トピックの要約タイトル>"
created: <ISO8601>
updated: <ISO8601>
sources:
  - raw/11/20261106_120000_a1b2.txt
tags:
  - pain/<分類>
  - status/ripe
---

## 1. Pain（課題・背景）
...

## 2. 目的（Outcome）
...

## 3. アイデア（Idea）
...

## 4. 作業・実装（Implementation）
...
```

---

## 5. モデル選定と評価（ローカル LLM / Embedding）

weaver および rag レイヤにおけるモデル候補と評価：

### 5.1 整形・醸成用 LLM（weaver レイヤ: 1M / 長文コンテキスト & 構造化）
1. **ローカル大型モデル（1M 級 / 長文バッチ）**:
   - **Qwen2.5-72B-Instruct / Qwen2.5-32B-Instruct**:
     - 評価: 日本語の理解度・指示追従性・構造化出力（JSON/YAML/Markdown）が極めて高い。128k コンテキスト対応。GPU マシンでのローカルバッチ推奨。
   - **Llama-3.1-70B-Instruct**:
     - 評価: 128k コンテキスト対応。論理的整理・アイデア抽出に強いが、日本語のニュアンス抽出は Qwen2.5 がやや優勢。
   - **Gemma-2-27B-It**:
     - 評価: 推論性能と日本語表現力が高い。中規模 GPU でも快適に動作。
2. **クラウド / 外部 API（必要時のフォールバック）**:
   - **Gemini 1.5 Pro / Flash**:
     - 評価: 1M〜2M トークンの超長文コンテキストを標準サポート。数ヶ月分の raw メモを一括で投入して月次・四半期レベルの大きなテーマ醸成を行う場合に最適。

### 5.2 埋め込みモデル（rag レイヤ: ベクトル検索用）
1. **bge-m3（BAAI）**:
   - 評価: **最推奨**。多言語（日本語・英語）対応、8192 トークン長文対応、密ベクトル（Dense）+ 疎ベクトル（Sparse / BM25）+ 多層表現のハイブリッド検索が可能。LM Studio や Ollama、Hugging Face TEI でローカル実行容易。
2. **text-embedding-3-small / text-embedding-3-large（OpenAI）**:
   - 評価: API コスト低・次元数可変。外部 API 許容時の標準。
3. **multilingual-e5-large**:
   - 評価: 高い検索精度だが、コンテキスト長が 512 トークンに制限されるため長文メモにはチャンキング必須。

---

## 6. パイプライン連携とデータフロー

```
[クライアント (crx/win/rust/mobile)]
             │
             ▼
      ~/.chira/ura.db (SQLite)
             │
             ▼ (chira wiki / rawのまま10件コミット)
      bonsai/wiki (GitHub)
      └── raw/<MM>/<ts>_<id>.txt   <-- 【不変】書き殴りそのまま
             │
             ▼ (非同期バッチ読み込み: GPUマシン / 定期実行)
      bonsai/weaver (エージェント)
             │  * 1Mコンテキスト / Qwen2.5 / Gemini
             │  * pain → 目的 / アイデア / 実装 の構造化
             ▼ (push)
      bonsai/wiki
      └── ripe/<YYYY>/<topic>.md   <-- 出典 raw へのトレーサビリティ付き
             │
             ▼ (読み込み & ベクトル化: bge-m3)
      bonsai/rag (ベクトルストア & 検索インデックス)
             │
             ▼ (クエリ / 検索)
      Muse / pi-coding / MCP
```

---

## 7. 結論と影響

- `chira-ura` の実装（`cli/wiki-push.js`, `api/src/wiki-push.js`）は現在の「**raw のまま 10 件ずつ commit push**」を維持する。
- 余計な LLM / embedding 依存を `chira-ura` に持ち込まず、クライアントの「**最速で書き殴る**」UX を最大化する。
- weaver / rag 側の設計指針（プロンプト・モデル候補）を確立し、三層アーキテクチャ（`dev/layers.md`）の設計を一貫性を持って前進させる。
