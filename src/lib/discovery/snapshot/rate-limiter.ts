/**
 * Rate Limiter for Public AI Research Snapshot Requests
 *
 * Implements sliding-window token consumption per client/IP identifier:
 * - Max 15 requests per 60-second window
 * - Enforces minimum 3-second spacing between requests from same client
 * - Bounded storage to prevent memory accumulation
 */

interface RateLimitRecord {
  timestamps: number[];
  lastRequest: number;
}

const WINDOW_MS = 60 * 1000; // 60 seconds
const MAX_REQUESTS_PER_WINDOW = 15;
const MIN_INTERVAL_MS = 3000; // 3 seconds minimum spacing

class SnapshotRateLimiter {
  private records = new Map<string, RateLimitRecord>();

  public checkLimit(clientId: string): { allowed: boolean; retryAfterMs?: number; reason?: string } {
    const now = Date.now();
    const id = clientId.trim() || "anonymous-global";

    let record = this.records.get(id);
    if (!record) {
      record = { timestamps: [], lastRequest: 0 };
      this.records.set(id, record);
    }

    // Check minimum interval
    const timeSinceLast = now - record.lastRequest;
    if (timeSinceLast < MIN_INTERVAL_MS && record.lastRequest !== 0) {
      const waitMs = MIN_INTERVAL_MS - timeSinceLast;
      return {
        allowed: false,
        retryAfterMs: waitMs,
        reason: `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another research snapshot.`,
      };
    }

    // Clean old timestamps outside sliding window
    record.timestamps = record.timestamps.filter((ts) => now - ts < WINDOW_MS);

    if (record.timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
      const oldest = record.timestamps[0];
      const resetTimeMs = WINDOW_MS - (now - oldest);
      return {
        allowed: false,
        retryAfterMs: resetTimeMs,
        reason: `Rate limit exceeded (max ${MAX_REQUESTS_PER_WINDOW} snapshots per minute). Please try again in ${Math.ceil(
          resetTimeMs / 1000
        )}s.`,
      };
    }

    // Record request
    record.timestamps.push(now);
    record.lastRequest = now;

    // Periodic cleanup of stale clients
    if (this.records.size > 2000) {
      this.records.forEach((r, k) => {
        if (now - r.lastRequest > WINDOW_MS * 5) {
          this.records.delete(k);
        }
      });
    }

    return { allowed: true };
  }

  public reset(clientId?: string): void {
    if (clientId) {
      this.records.delete(clientId);
    } else {
      this.records.clear();
    }
  }
}

export const snapshotRateLimiter = new SnapshotRateLimiter();
