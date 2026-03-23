import { Database } from "bun:sqlite";
import type { Finding, ReviewMeta, ReviewRecord, ReviewListItem, Severity } from "../pipeline/types";
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

CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id, suppressed);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_review ON pipeline_runs(review_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at DESC);
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
    let query = `SELECT * FROM findings WHERE review_id = ? AND suppressed = 0`;
    const params: unknown[] = [reviewId];

    if (minSeverity) {
      const idx = SEVERITY_ORDER.indexOf(minSeverity);
      const allowed = SEVERITY_ORDER.slice(0, idx + 1);
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
      suggestion: r.suggestion ? parseSuggestion(r.suggestion as string) : undefined,
      confidence: r.confidence as number,
      stage: r.stage as string,
    }));
  }

  listReviews(limit: number): ReviewListItem[] {
    const clampedLimit = Math.min(Math.max(limit, 1), 1000);
    const rows = this.db
      .prepare(
        `SELECT r.id, r.project, r.status, r.source, r.base_ref, r.head_ref, r.created_at,
                COUNT(f.id) as finding_count,
                SUM(CASE WHEN f.severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
                SUM(CASE WHEN f.severity = 'warning' THEN 1 ELSE 0 END) as warning_count
         FROM reviews r
         LEFT JOIN findings f ON f.review_id = r.id AND f.suppressed = 0
         GROUP BY r.id
         ORDER BY r.created_at DESC
         LIMIT ?`
      )
      .all(clampedLimit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as string,
      project: r.project as string,
      status: r.status as string,
      source: r.source as string,
      base_ref: r.base_ref as string,
      head_ref: r.head_ref as string,
      created_at: r.created_at as string,
      finding_count: (r.finding_count as number) ?? 0,
      critical_count: (r.critical_count as number) ?? 0,
      warning_count: (r.warning_count as number) ?? 0,
    }));
  }

  getReview(id: string): ReviewRecord | null {
    if (id.length < 8) {
      throw new Error(`Review ID must be at least 8 characters (got ${id.length})`);
    }

    // Use range query for efficient prefix matching on indexed PRIMARY KEY
    const upperBound = id.slice(0, -1) + String.fromCharCode(id.charCodeAt(id.length - 1) + 1);
    const rows = this.db
      .prepare(`SELECT * FROM reviews WHERE id >= ? AND id < ? LIMIT 2`)
      .all(id, upperBound) as Record<string, unknown>[];

    if (rows.length === 0) return null;
    if (rows.length > 1) {
      throw new Error(`Ambiguous review ID "${id}" — matches multiple reviews. Use a longer prefix.`);
    }

    const row = rows[0];
    return {
      id: row.id as string,
      project: row.project as string,
      status: row.status as string,
      source: row.source as string,
      base_ref: row.base_ref as string,
      head_ref: row.head_ref as string,
      created_at: row.created_at as string,
    };
  }

  getTokensUsed(reviewId: string): number {
    const row = this.db
      .prepare(`SELECT SUM(tokens_used) as total FROM pipeline_runs WHERE review_id = ?`)
      .get(reviewId) as Record<string, unknown> | null;
    return (row?.total as number) ?? 0;
  }

  close(): void {
    this.db.close();
  }
}

function parseSuggestion(raw: string): Finding["suggestion"] | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    if ("__proto__" in parsed || "constructor" in parsed || "prototype" in parsed) return undefined;
    return {
      description: typeof parsed.description === "string" ? parsed.description : "",
      diff: typeof parsed.diff === "string" ? parsed.diff : undefined,
    };
  } catch {
    return undefined;
  }
}
