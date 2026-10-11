/**
 * CitedEvidence API Safeguards, Resilience & Rate Limiting
 *
 * Implements defensive infrastructure protecting the shared upstream API key:
 * - Provider-wide sliding window rate limiter (<= 20 req/min, well below 30 cap)
 * - Per-user rate limiting (<= 10 req/min)
 * - Bounded concurrency semaphore (max 3 concurrent requests)
 * - Retry-After aware exponential backoff with jitter
 * - Circuit breaker (fast-fails to PubMed/Crossref fallback during upstream outages)
 * - In-memory query cache with TTL (5 min)
 * - Multi-instance rate-limiting store abstraction (extensible to Redis/PostgreSQL)
 * - Telemetry & monthly quota threshold monitoring
 */

export class CircuitBreakerOpenError extends Error {
  constructor(message: string = "CitedEvidence circuit breaker is OPEN due to repeated upstream failures.") {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number = 60) {
    super(message);
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
}

/**
 * Shared interface for rate limiting storage (in-memory default, compatible with Redis/DB).
 */
export interface RateLimiterStore {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

class MemoryRateLimiterStore implements RateLimiterStore {
  private hits: Map<string, number[]> = new Map();

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const timestamps = this.hits.get(key) || [];
    const valid = timestamps.filter((t) => now - t < windowMs);

    if (valid.length >= limit) {
      const oldest = valid[0];
      const resetMs = oldest + windowMs - now;
      const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
      this.hits.set(key, valid);
      return { success: false, remaining: 0, resetMs, retryAfterSeconds };
    }

    valid.push(now);
    this.hits.set(key, valid);
    const resetMs = windowMs;
    return {
      success: true,
      remaining: Math.max(0, limit - valid.length),
      resetMs,
      retryAfterSeconds: 0,
    };
  }

  reset() {
    this.hits.clear();
  }
}

/**
 * Bounded Concurrency Semaphore
 */
class ConcurrencySemaphore {
  private activeCount = 0;
  private readonly maxConcurrent: number;
  private queue: Array<() => void> = [];

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.activeCount++;
        resolve();
      });
    });
  }

  release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) next();
    }
  }

  getActiveCount(): number {
    return this.activeCount;
  }
}

/**
 * Circuit Breaker implementation
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(failureThreshold: number = 3, cooldownMs: number = 60000) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
  }

  getState(): CircuitState {
    if (this.state === "OPEN" && Date.now() - this.lastFailureTime > this.cooldownMs) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "CLOSED";
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  reset(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }
}

/**
 * LRU In-Memory Query Cache (5 min TTL)
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class QueryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number = 300000, maxEntries: number = 500) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Usage Telemetry & Budget Monitoring
 */
export interface SafeguardTelemetry {
  totalRequests: number;
  metadataRequests: number;
  toolRequests: number;
  cacheHits: number;
  rateLimitHits: number;
  circuitBreakerTrips: number;
  activeConcurrency: number;
  circuitState: CircuitState;
  budgetWarning: boolean;
}

class TelemetryManager {
  private totalRequests = 0;
  private metadataRequests = 0;
  private toolRequests = 0;
  private cacheHits = 0;
  private rateLimitHits = 0;
  private circuitBreakerTrips = 0;

  // Monthly budget alert thresholds (80% of observed limits)
  private readonly metadataWarningThreshold = 80000;
  private readonly toolsWarningThreshold = 34560;

  recordRequest(type: "metadata" | "tool") {
    this.totalRequests++;
    if (type === "metadata") {
      this.metadataRequests++;
      if (this.metadataRequests === this.metadataWarningThreshold) {
        console.warn(`[CitedEvidence Alert] Metadata monthly usage reached 80% budget (${this.metadataRequests}/100,000).`);
      }
    } else {
      this.toolRequests++;
      if (this.toolRequests === this.toolsWarningThreshold) {
        console.warn(`[CitedEvidence Alert] Research tools monthly usage reached 80% budget (${this.toolRequests}/43,200).`);
      }
    }
  }

  recordCacheHit() {
    this.cacheHits++;
  }

  recordRateLimit() {
    this.rateLimitHits++;
  }

  recordCircuitTrip() {
    this.circuitBreakerTrips++;
  }

  getSnapshot(circuitState: CircuitState, activeConcurrency: number): SafeguardTelemetry {
    return {
      totalRequests: this.totalRequests,
      metadataRequests: this.metadataRequests,
      toolRequests: this.toolRequests,
      cacheHits: this.cacheHits,
      rateLimitHits: this.rateLimitHits,
      circuitBreakerTrips: this.circuitBreakerTrips,
      activeConcurrency,
      circuitState,
      budgetWarning:
        this.metadataRequests >= this.metadataWarningThreshold ||
        this.toolRequests >= this.toolsWarningThreshold,
    };
  }

  reset() {
    this.totalRequests = 0;
    this.metadataRequests = 0;
    this.toolRequests = 0;
    this.cacheHits = 0;
    this.rateLimitHits = 0;
    this.circuitBreakerTrips = 0;
  }
}

/**
 * Master Safeguard Orchestrator Singleton
 */
export class CitedEvidenceSafeguards {
  private store: RateLimiterStore;
  private semaphore: ConcurrencySemaphore;
  private circuitBreaker: CircuitBreaker;
  private cache: QueryCache;
  private telemetry: TelemetryManager;

  // Configurable limits
  readonly providerReqsPerMinute: number;
  readonly userReqsPerMinute: number;

  constructor(customStore?: RateLimiterStore) {
    this.store = customStore || new MemoryRateLimiterStore();
    this.semaphore = new ConcurrencySemaphore(
      Number(process.env.CITEDEVIDENCE_MAX_CONCURRENT || 3)
    );
    this.circuitBreaker = new CircuitBreaker(3, 60000);
    this.cache = new QueryCache(300000, 500);
    this.telemetry = new TelemetryManager();

    this.providerReqsPerMinute = Number(
      process.env.CITEDEVIDENCE_MAX_REQUESTS_PER_MINUTE || 20
    );
    this.userReqsPerMinute = Number(
      process.env.CITEDEVIDENCE_USER_MAX_REQUESTS_PER_MINUTE || 10
    );
  }

  /**
   * Evaluates rate limits for the provider and individual user.
   */
  async checkRateLimits(userId?: string): Promise<void> {
    // 1. Check Circuit Breaker
    const cState = this.circuitBreaker.getState();
    if (cState === "OPEN") {
      throw new CircuitBreakerOpenError();
    }

    // 2. Check Provider-Wide Rate Limit
    const provRes = await this.store.consume(
      "ce_provider_global",
      this.providerReqsPerMinute,
      60000
    );
    if (!provRes.success) {
      this.telemetry.recordRateLimit();
      throw new RateLimitExceededError(
        `CitedEvidence provider rate limit reached. Retry in ${provRes.retryAfterSeconds}s.`,
        provRes.retryAfterSeconds
      );
    }

    // 3. Check Per-User Rate Limit (if user identified)
    if (userId) {
      const userRes = await this.store.consume(
        `ce_user_${userId}`,
        this.userReqsPerMinute,
        60000
      );
      if (!userRes.success) {
        this.telemetry.recordRateLimit();
        throw new RateLimitExceededError(
          `User research quota reached (max ${this.userReqsPerMinute} calls/min). Retry in ${userRes.retryAfterSeconds}s.`,
          userRes.retryAfterSeconds
        );
      }
    }
  }

  /**
   * Executes an outbound request through concurrency semaphore, circuit breaker, and retry logic.
   */
  async executeGuarded<T>(
    type: "metadata" | "tool",
    operation: () => Promise<T>,
    options: { userId?: string; cacheKey?: string; maxRetries?: number } = {}
  ): Promise<T> {
    const { userId, cacheKey, maxRetries = 2 } = options;

    // Cache hit check
    if (cacheKey) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached) {
        this.telemetry.recordCacheHit();
        return cached;
      }
    }

    // Rate limit check
    await this.checkRateLimits(userId);

    // Acquire concurrency lock
    await this.semaphore.acquire();
    try {
      this.telemetry.recordRequest(type);

      let lastError: any;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await operation();
          this.circuitBreaker.recordSuccess();

          if (cacheKey) {
            this.cache.set(cacheKey, result);
          }
          return result;
        } catch (err: any) {
          lastError = err;
          const is429 = err?.status === 429 || err?.message?.includes("429");
          const is503 = err?.status === 503 || err?.message?.includes("503");

          if (is429 || is503) {
            this.circuitBreaker.recordFailure();
            if (this.circuitBreaker.getState() === "OPEN") {
              this.telemetry.recordCircuitTrip();
              throw new CircuitBreakerOpenError();
            }

            if (attempt < maxRetries) {
              const upstreamRetrySec = err?.retryAfterSeconds;
              const backoffMs = upstreamRetrySec
                ? Math.min(upstreamRetrySec * 1000, 10000)
                : Math.min(
                    1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 300),
                    5000
                  );
              await new Promise((r) => setTimeout(r, backoffMs));
              continue;
            }
          }

          throw err;
        }
      }
      throw lastError;
    } finally {
      this.semaphore.release();
    }
  }

  getTelemetry(): SafeguardTelemetry {
    return this.telemetry.getSnapshot(
      this.circuitBreaker.getState(),
      this.semaphore.getActiveCount()
    );
  }

  resetForTests(): void {
    if ("reset" in this.store && typeof (this.store as any).reset === "function") {
      (this.store as any).reset();
    }
    this.circuitBreaker.reset();
    this.cache.clear();
    this.telemetry.reset();
  }
}

// Global Singleton
export const citedEvidenceSafeguards = new CitedEvidenceSafeguards();
