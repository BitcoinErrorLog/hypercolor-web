/**
 * RetryQueue increment / cap / max-age against real v13 SQL.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDbForTests } from "../db";
import { openMemoryDb } from "../db/__tests__/betterSqliteAdapter";
import { runMigrations } from "../db/migrations";
import type { DeliveryQueueItem } from "../types";
import { StorageService } from "./StorageService";
import {
  MAX_AGE_MS,
  MAX_ATTEMPTS,
  RETIRED_ITEM_PARK_MS,
  RetryQueue,
  isRetired,
} from "./RetryQueue";

const PEER = "z".repeat(52);

function queueInput(id: string) {
  return {
    id,
    messageId: "evt-1",
    recipientPubky: PEER,
    payload: '{"type":"link.chat.message"}',
  };
}

describe("RetryQueue", () => {
  beforeEach(async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
  });

  afterEach(() => {
    setDbForTests(null);
  });

  it("increments attempts internally when call sites pass the un-incremented count", async () => {
    await RetryQueue.enqueue(queueInput("q-1"));
    const before = (await StorageService.listDeliveryQueue())[0];
    expect(before?.attempts).toBe(0);

    const dropped = await RetryQueue.recordFailure("q-1", before!.attempts);
    expect(dropped).toBe(false);

    const after = (await StorageService.listDeliveryQueue())[0];
    expect(after?.attempts).toBe(1);
    expect(after!.nextRetryAt).toBeGreaterThan(Date.now());
  });

  it("caps attempts and removes the item so it is not auto-retried", async () => {
    await RetryQueue.enqueue(queueInput("q-cap"));
    const dropped = await RetryQueue.recordFailure("q-cap", MAX_ATTEMPTS - 1);
    expect(dropped).toBe(true);
    expect(await StorageService.listDeliveryQueue()).toEqual([]);
  });

  it("does not increment on defer", async () => {
    await RetryQueue.enqueue(queueInput("q-defer"));
    await RetryQueue.defer("q-defer", 0);
    const after = (await StorageService.listDeliveryQueue())[0];
    expect(after?.attempts).toBe(0);
  });

  it("parks past the backoff cap so getDue does not resurface the item", async () => {
    await RetryQueue.enqueue(queueInput("q-park"));
    await RetryQueue.park("q-park");
    const due = await RetryQueue.getDue();
    expect(due.find((item) => item.id === "q-park")).toBeUndefined();
    const parked = (await StorageService.listDeliveryQueue())[0];
    expect(parked?.nextRetryAt).toBeGreaterThan(Date.now() + RETIRED_ITEM_PARK_MS - 5_000);
    expect(parked?.nextRetryAt).toBeGreaterThan(Date.now() + 30 * 60 * 1000);
  });

  it("retires items that exceed max age", () => {
    const now = 1_700_000_000_000;
    const fresh: DeliveryQueueItem = {
      id: "fresh",
      messageId: "evt",
      recipientPubky: PEER,
      payload: "{}",
      attempts: 0,
      nextRetryAt: now,
      createdAt: now,
    };
    const aged: DeliveryQueueItem = {
      ...fresh,
      id: "aged",
      createdAt: now - MAX_AGE_MS,
    };
    expect(isRetired(fresh, now)).toBe(false);
    expect(isRetired(aged, now)).toBe(true);
  });
});
