import { StorageService } from "./StorageService";
import type { DeliveryQueueItem } from "../types";

/**
 * RetryQueue — persistent exponential-backoff retry queue for Pubky outbox
 * deliveries.
 *
 * Items survive restarts because they live in SQLite. The queue is drained
 * by LinkService.drainRetries (and after syncInbox).
 *
 * Backoff schedule (capped at 30 minutes):
 *   attempt 1 → 30 s
 *   attempt 2 → 1 min
 *   attempt 3 → 2 min
 *   attempt 4 → 4 min
 *   attempt N → min(2^N × 15 s, 1800 s)
 */

const MAX_ATTEMPTS = 10;

function nextRetryMs(attempts: number): number {
  const delayMs = Math.min(15_000 * Math.pow(2, attempts), 30 * 60 * 1000);
  return Date.now() + delayMs;
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

  async recordSuccess(id: string): Promise<void> {
    await StorageService.removeFromQueue(id);
  },
};
