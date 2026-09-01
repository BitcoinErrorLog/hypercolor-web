import { StorageService } from "./StorageService";
import type { DeliveryQueueItem } from "../types";

/**
 * RetryQueue — persistent exponential-backoff retry queue for Pubky outbox
 * deliveries.
 *
 * Items survive restarts because they live in SQLite. The queue is drained
 * by LinkService.drainRetries (and after syncInbox).
 *
 * Call sites pass `item.attempts` un-incremented. Increment and the attempt
 * cap live here (`recordFailure` → `StorageService.incrementAttempt`).
 *
 * Backoff schedule (capped at 30 minutes):
 *   attempt 1 → 30 s
 *   attempt 2 → 1 min
 *   attempt 3 → 2 min
 *   attempt 4 → 4 min
 *   attempt N → min(2^N × 15 s, 1800 s)
 *
 * Retirement (no further auto-retry; caller marks the row failed):
 *   - 10 attempts
 *   - 24 hours since `createdAt`
 */

export const MAX_ATTEMPTS = 10;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Retired items stay in the queue (send-path drain must still see them) but
 * must not consume `getDue` slots. Backoff is capped at 30 minutes, so park
 * writes `next_retry_at` directly instead of going through `defer`. */
export const RETIRED_ITEM_PARK_MS = 365 * 24 * 60 * 60 * 1000;

function nextRetryMs(attempts: number): number {
  const delayMs = Math.min(15_000 * Math.pow(2, attempts), 30 * 60 * 1000);
  return Date.now() + delayMs;
}

export function isRetired(item: DeliveryQueueItem, now = Date.now()): boolean {
  return item.attempts >= MAX_ATTEMPTS || now - item.createdAt >= MAX_AGE_MS;
}

export const RetryQueue = {
  async enqueue(
    item: Omit<DeliveryQueueItem, "attempts" | "nextRetryAt" | "createdAt">,
  ): Promise<void> {
    const now = Date.now();
    await StorageService.enqueue({
      ...item,
      attempts: 0,
      nextRetryAt: now,
      createdAt: now,
    });
  },

  async getDue(limit = 10): Promise<DeliveryQueueItem[]> {
    return StorageService.dequeue(limit);
  },

  async recordFailure(id: string, currentAttempts: number): Promise<boolean> {
    if (currentAttempts + 1 >= MAX_ATTEMPTS) {
      await StorageService.removeFromQueue(id);
      return true;
    }
    await StorageService.incrementAttempt(id, nextRetryMs(currentAttempts + 1));
    return false;
  },

  async defer(id: string, currentAttempts: number): Promise<void> {
    await StorageService.deferQueueItem(id, nextRetryMs(currentAttempts));
  },

  async park(id: string, untilMs = Date.now() + RETIRED_ITEM_PARK_MS): Promise<void> {
    await StorageService.deferQueueItem(id, untilMs);
  },

  async recordSuccess(id: string): Promise<void> {
    await StorageService.removeFromQueue(id);
  },
};
