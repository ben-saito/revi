export interface RateLimitConfig {
  max_reviews_per_hour: number;
  max_budget_per_hour_usd: number;
  max_budget_per_day_usd: number;
  cooldown_between_stages_ms: number;
  max_concurrent_reviews: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  max_reviews_per_hour: 10,
  max_budget_per_hour_usd: 3.0,
  max_budget_per_day_usd: 20.0,
  cooldown_between_stages_ms: 2000,
  max_concurrent_reviews: 2,
};

export class RateLimiter {
  private config: RateLimitConfig;
  private callTimestamps: number[] = [];
  private hourlySpend = 0;
  private dailySpend = 0;
  private hourResetAt = Date.now() + 3600_000;
  private dayResetAt = Date.now() + 86400_000;
  private consecutiveErrors = 0;
  private circuitOpenUntil = 0;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async acquire(): Promise<void> {
    // サーキットブレーカー
    if (Date.now() < this.circuitOpenUntil) {
      const waitMs = this.circuitOpenUntil - Date.now();
      throw new Error(
        `Circuit breaker open. Retry after ${Math.ceil(waitMs / 1000)}s`
      );
    }

    this.resetWindowsIfNeeded();

    // Prune old timestamps and check hourly limit
    this.callTimestamps = this.callTimestamps.filter(
      (t) => Date.now() - t < 3600_000
    );
    if (this.callTimestamps.length >= this.config.max_reviews_per_hour) {
      const oldestInWindow = Math.min(...this.callTimestamps);
      const waitMs = oldestInWindow + 3600_000 - Date.now();
      await sleep(waitMs);
    }

    // コスト上限チェック
    if (this.hourlySpend >= this.config.max_budget_per_hour_usd) {
      throw new Error(
        `Hourly budget exceeded: $${this.hourlySpend.toFixed(2)}/$${this.config.max_budget_per_hour_usd}`
      );
    }
    if (this.dailySpend >= this.config.max_budget_per_day_usd) {
      throw new Error(
        `Daily budget exceeded: $${this.dailySpend.toFixed(2)}/$${this.config.max_budget_per_day_usd}`
      );
    }

    this.callTimestamps.push(Date.now());
  }

  reportSuccess(costUsd: number): void {
    this.consecutiveErrors = 0;
    this.hourlySpend += costUsd;
    this.dailySpend += costUsd;
  }

  reportError(status?: number): void {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= 5) {
      // サーキットブレーカー発動: 10分停止
      this.circuitOpenUntil = Date.now() + 600_000;
      this.consecutiveErrors = 0;
    }
  }

  async backoff(attempt: number, retryAfterMs?: number): Promise<void> {
    const baseDelay = retryAfterMs ?? Math.min(1000 * 2 ** attempt, 60_000);
    const jitter = baseDelay * (0.75 + Math.random() * 0.5);
    await sleep(jitter);
  }

  async stageCooldown(): Promise<void> {
    const base = this.config.cooldown_between_stages_ms;
    await sleep(base + Math.random() * (base / 2));
  }

  private resetWindowsIfNeeded(): void {
    const now = Date.now();
    if (now >= this.hourResetAt) {
      this.hourlySpend = 0;
      this.hourResetAt = now + 3600_000;
    }
    if (now >= this.dayResetAt) {
      this.dailySpend = 0;
      this.dayResetAt = now + 86400_000;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
