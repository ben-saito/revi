#!/usr/bin/env bun
import { Command } from "commander";
import { reviewCommand } from "./commands/review";
import { initCommand } from "./commands/init";

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
  .option("--pr <number>", "GitHub PR number")
  .option("--commit <sha>", "Specific commit SHA")
  .option("--format <type>", "Output format: terminal, json, markdown", "terminal")
  .option("--severity <level>", "Minimum severity: critical, warning, suggestion, info", "suggestion")
  .option("--provider <name>", "AI provider: claude-code, claude")
  .option("--stages <list>", "Comma-separated stage names")
  .option("--project-dir <path>", "Project root directory", ".")
  .action(reviewCommand);

program
  .command("init")
  .description("Initialize .revi/ configuration")
  .option("--project-dir <path>", "Project root directory", ".")
  .action(initCommand);

program.parse();
