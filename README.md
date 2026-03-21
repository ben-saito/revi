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

# 直接API利用（APIキー必要）
revi review --provider claude --project-dir /path/to/your/project
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
