#!/usr/bin/env bun
import { Command } from "commander";
import { reviewCommand } from "./commands/review";
import { initCommand } from "./commands/init";
import { historyCommand } from "./commands/history";
import { showCommand } from "./commands/show";

const program = new Command();

program
  .name("revi")
  .description("AI-powered code review system")
  .version("0.1.0");

program
  .command("review")
  .description("Review code changes")
  .option("--base <ref>", "Base ref to diff against", "HEAD~1")
  .option("--head <ref>", "Head ref", "HEAD")
  .option("--working-tree", "Review uncommitted changes against base (default: HEAD)")
  .option("--pr <number>", "GitHub PR number")
  .option("--commit <sha>", "Specific commit SHA")
  .option("--format <type>", "Output format: terminal, json, markdown", "terminal")
  .option("--severity <level>", "Minimum severity: critical, warning, suggestion, info", "suggestion")
  .option("--language <lang>", "Output language for findings (e.g. Japanese, Chinese, Korean)")
  .option("--provider <name>", "AI provider: claude-code, claude")
  .option("--stages <list>", "Comma-separated stage names")
  .option("--project-dir <path>", "Project root directory", ".")
  .action(reviewCommand);

program
  .command("init")
  .description("Initialize .revi/ configuration")
  .option("--project-dir <path>", "Project root directory", ".")
  .action(initCommand);

program
  .command("history")
  .description("List past reviews")
  .option("--project-dir <path>", "Project root directory", ".")
  .option("--limit <n>", "Number of reviews to show", "10")
  .option("--format <type>", "Output format: terminal, json, markdown", "terminal")
  .action(historyCommand);

program
  .command("show <review_id>")
  .description("Show details of a specific review")
  .option("--project-dir <path>", "Project root directory", ".")
  .option("--format <type>", "Output format: terminal, json, markdown", "terminal")
  .option("--severity <level>", "Minimum severity: critical, warning, suggestion, info")
  .action(showCommand);

program.parse();
