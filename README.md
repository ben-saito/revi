# Revi — AI-Powered Code Review System

汎用的なAI駆動コードレビューシステム。[sashiko](https://github.com/sashiko-dev/sashiko)の設計思想を継承し、任意の言語・プロジェクトに対応。

## Features

- **言語非依存** — 任意のプログラミング言語のコードをレビュー
- **マルチステージパイプライン** — Parse → Understand → Review → Integrate → Report
- **4観点レビュー** — correctness, security, performance, maintainability
- **Claude Code認証対応** — APIキー不要、Claude Codeのサブスクリプションで動作
- **レート制御 & BAN回避** — アダプティブレート制御、サーキットブレーカー、エクスポネンシャルバックオフ
- **構造化出力** — JSON / Markdown / Terminal 形式で結果出力
- **カスタマイズ可能** — プロジェクト固有のルール・プロンプト・ステージを定義可能

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Claude Code](https://claude.ai/claude-code) (認証済み)
- Git

### Install

```bash
git clone https://github.com/ben-saito/revi.git
cd revi
bun install
bun link    # グローバルインストール（revi コマンドが使えるようになる）
```

これで `revi` コマンドがどのディレクトリからでも使えます。

### Usage

```bash
# プロジェクト初期化
revi init --project-dir /path/to/your/project

# レビュー実行（現在のブランチの直前コミットとの差分）
revi review --project-dir /path/to/your/project

# mainブランチとの差分をレビュー
revi review --base main --project-dir /path/to/your/project

# 特定コミットをレビュー
revi review --commit abc1234 --project-dir /path/to/your/project

# JSON出力
revi review --format json --project-dir /path/to/your/project

# warning以上のみ表示
revi review --severity warning --project-dir /path/to/your/project

# 日本語でレビュー結果を受け取る
revi review --language Japanese --project-dir /path/to/your/project

# 直接API利用（APIキー必要）
revi review --provider claude --project-dir /path/to/your/project
```

## Output Examples

Revi は 3 つの出力形式をサポートしています。

### Terminal (デフォルト)

```bash
revi review --project-dir .
```

```
▸ Revi Review
  Project:  my-app
  Provider: claude-code
  Diff:     HEAD~1..HEAD
  Stages:   parse → understand → review → integrate → report

Found 3 issue(s):

● ユーザー検索時のNull参照
  src/services/user.ts:42 | critical | confidence: 0.92
  fetchUser() はユーザーが見つからない場合に undefined を返しますが、呼び出し元が
  nullチェックなしで .name にアクセスしています。実行時に例外がスローされます。

● SQL文の文字列結合による組み立て
  src/db/queries.ts:18 | warning | confidence: 0.88
  ユーザー入力がSQL文字列に直接埋め込まれています。SQLインジェクション防止のため、
  パラメータ化クエリを使用してください。

○ 未使用のインポート
  src/utils/helpers.ts:1 | suggestion | confidence: 0.95
  'lodash' がインポートされていますが、このファイル内で使用されていません。

Tokens used: 12,450
```

問題がない場合:

```
▸ Revi Review
  Project:  my-app
  Provider: claude-code
  Diff:     HEAD~1..HEAD
  Stages:   parse → understand → review → integrate → report

✓ No issues found
  Tokens used: 8,230
```

### JSON

```bash
revi review --format json --project-dir .
```

```json
{
  "review_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "project": "my-app",
  "ref": "HEAD~1..HEAD",
  "timestamp": "2026-03-22T18:30:00.000Z",
  "summary": {
    "total": 2,
    "by_severity": {
      "critical": 1,
      "warning": 1,
      "suggestion": 0,
      "info": 0
    },
    "by_category": {
      "correctness": 1,
      "security": 1
    }
  },
  "findings": [
    {
      "id": "f1a2b3c4-...",
      "file": "src/services/user.ts",
      "line_start": 42,
      "line_end": 42,
      "severity": "critical",
      "category": "correctness",
      "title": "ユーザー検索時のNull参照",
      "description": "fetchUser() はユーザーが見つからない場合に undefined を返しますが、呼び出し元がnullチェックなしで .name にアクセスしています。",
      "suggestion": {
        "description": "プロパティアクセス前にnullチェックを追加",
        "diff": "- const name = fetchUser(id).name;\n+ const user = fetchUser(id);\n+ if (!user) throw new Error(`User not found: ${id}`);\n+ const name = user.name;"
      },
      "confidence": 0.92,
      "stage": "review"
    },
    {
      "id": "e5f6a7b8-...",
      "file": "src/db/queries.ts",
      "line_start": 18,
      "line_end": 20,
      "severity": "warning",
      "category": "security",
      "title": "SQL文の文字列結合による組み立て",
      "description": "ユーザー入力がSQL文字列に直接埋め込まれています。",
      "suggestion": {
        "description": "パラメータ化クエリを使用",
        "diff": "- db.query(`SELECT * FROM users WHERE id = '${userId}'`);\n+ db.query(`SELECT * FROM users WHERE id = ?`, [userId]);"
      },
      "confidence": 0.88,
      "stage": "review"
    }
  ]
}
```

### Markdown

```bash
revi review --format markdown --project-dir .
```

````markdown
# Revi Review Report
**Project:** my-app
**Ref:** HEAD~1..HEAD
**Date:** 2026-03-22T18:30:00.000Z

## Summary
Total findings: **2**

| Severity | Count |
|----------|-------|
| 🔴 critical | 1 |
| 🟡 warning | 1 |

## Findings

### 🔴 ユーザー検索時のNull参照
**critical** | correctness | `src/services/user.ts:42` | confidence: 0.92

fetchUser() はユーザーが見つからない場合に undefined を返しますが、呼び出し元が
nullチェックなしで .name にアクセスしています。実行時に例外がスローされます。

**Suggestion:** プロパティアクセス前にnullチェックを追加
```diff
- const name = fetchUser(id).name;
+ const user = fetchUser(id);
+ if (!user) throw new Error(`User not found: ${id}`);
+ const name = user.name;
```

---

### 🟡 SQL文の文字列結合による組み立て
**warning** | security | `src/db/queries.ts:18-20` | confidence: 0.88

ユーザー入力がSQL文字列に直接埋め込まれています。

**Suggestion:** パラメータ化クエリを使用
```diff
- db.query(`SELECT * FROM users WHERE id = '${userId}'`);
+ db.query(`SELECT * FROM users WHERE id = ?`, [userId]);
```

---
````

### Severity フィルタ

`--severity` で表示する最小レベルを指定できます:

```bash
# warning 以上（critical + warning）のみ表示
revi review --severity warning --project-dir .

# critical のみ表示
revi review --severity critical --project-dir .
```

## Architecture

```
┌──────────┐    ┌──────────────────────────────────────┐
│ revi CLI │───▶│          Review Pipeline              │
└──────────┘    │                                      │
                │  Parse → Understand → Review         │
                │    → Integrate → Report              │
                │                                      │
                │  ┌────────────┐ ┌──────────┐        │
                │  │ AiProvider │ │ ToolBox  │         │
                │  │(claude-code│ │(git ops, │         │
                │  │ / claude)  │ │ file I/O)│         │
                │  └────────────┘ └──────────┘        │
                │                                      │
                │  ┌────────────┐ ┌──────────┐        │
                │  │PromptReg   │ │  SQLite  │         │
                │  └────────────┘ └──────────┘        │
                └──────────────────────────────────────┘
```

## Configuration

`revi init` で `.revi/config.toml` が生成されます:

```toml
[project]
name = "my-app"

[provider]
default = "claude-code"    # APIキー不要

[pipeline]
stages = ["parse", "understand", "review", "integrate", "report"]

[review]
aspects = ["correctness", "security", "performance", "maintainability"]
severity_threshold = "suggestion"
max_findings_per_file = 10
# output_language = "Japanese"  # レビュー結果の言語（未設定時は英語）

[rate_limit]
max_reviews_per_hour = 10
max_budget_per_day_usd = 20.00
```

### Custom Prompts

`.revi/prompts/` にMarkdownファイルを配置するとビルトインプロンプトをオーバーライドできます:

```
.revi/prompts/
  review/correctness.md
  review/security.md
  understand.md
```

## Providers

| Provider | 認証 | 用途 |
|----------|------|------|
| `claude-code` | Claude Code サブスクリプション（デフォルト） | ローカル開発 |
| `claude` | `ANTHROPIC_API_KEY` 環境変数 | CI/CD |

## Project Structure

```
src/
├── cli/           # CLI (commander)
├── ai/            # AiProvider + レート制御
├── pipeline/      # エンジン + ステージ
├── tools/         # ToolBox (git, file ops)
├── prompts/       # PromptRegistry
├── store/         # SQLite (bun:sqlite)
└── config/        # TOML設定ローダー
```

## Inspired By

- [sashiko](https://github.com/sashiko-dev/sashiko) — Linux kernel patch review system

## License

MIT
