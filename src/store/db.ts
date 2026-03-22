import { Database } from "bun:sqlite";
import type { Finding, ReviewMeta, Severity } from "../pipeline/types";
import { SEVERITY_ORDER, type ReviewStatus } from "../utils";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  source TEXT NOT NULL,
  ref_id TEXT,
  base_ref TEXT,
  head_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id),
  stages TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  tokens_used INTEGER DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id),
  stage TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  suggestion TEXT,
  confidence REAL DEFAULT 0.5,
  suppressed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
`;

export class Store {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  createReview(meta: ReviewMeta): void {
    this.db
      .prepare(
        `INSERT INTO reviews (id, project, source, ref_id, base_ref, head_ref) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        meta.id,
        meta.project,
        meta.source,
        meta.ref_id ?? null,
        meta.base_ref,
        meta.head_ref
      );
  }

  updateReviewStatus(id: string, status: ReviewStatus): void {
    this.db
      .prepare(`UPDATE reviews SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, id);
  }

  createPipelineRun(id: string, reviewId: string, stages: string[]): void {
    this.db
      .prepare(`INSERT INTO pipeline_runs (id, review_id, stages) VALUES (?, ?, ?)`)
      .run(id, reviewId, JSON.stringify(stages));
  }

  completePipelineRun(id: string, tokensUsed: number): void {
    this.db
      .prepare(
        `UPDATE pipeline_runs SET status = 'completed', tokens_used = ?, finished_at = datetime('now') WHERE id = ?`
      )
      .run(tokensUsed, id);
  }

  insertFindings(reviewId: string, findings: Finding[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO findings (id, review_id, stage, file_path, line_start, line_end, severity, category, title, description, suggestion, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = this.db.transaction(() => {
      for (const f of findings) {
        stmt.run(
          f.id,
          reviewId,
          f.stage,
          f.file,
          f.line_start ?? null,
          f.line_end ?? null,
          f.severity,
          f.category,
          f.title,
          f.description,
          f.suggestion ? JSON.stringify(f.suggestion) : null,
          f.confidence
        );
      }
    });
    tx();
  }

  getFindings(reviewId: string, minSeverity?: Severity): Finding[] {
    const severityOrder = SEVERITY_ORDER;
    let query = `SELECT * FROM findings WHERE review_id = ? AND suppressed = 0`;
    const params: unknown[] = [reviewId];

    if (minSeverity) {
      const idx = severityOrder.indexOf(minSeverity);
      const allowed = severityOrder.slice(0, idx + 1);
      query += ` AND severity IN (${allowed.map(() => "?").join(",")})`;
      params.push(...allowed);
    }

    query += ` ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'suggestion' THEN 2 ELSE 3 END`;

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      file: r.file_path as string,
      line_start: r.line_start as number | undefined,
      line_end: r.line_end as number | undefined,
      severity: r.severity as Severity,
      category: r.category as string as Finding["category"],
      title: r.title as string,
      description: r.description as string,
      suggestion: r.suggestion ? JSON.parse(r.suggestion as string) : undefined,
      confidence: r.confidence as number,
      stage: r.stage as string,
    }));
  }

  close(): void {
    this.db.close();
  }
}
