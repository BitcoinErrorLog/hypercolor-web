import { describe, expect, it, vi } from "vitest";
import { createInboxRefresher, type InboxRefreshDeps, type InboxSnapshot } from "./inbox-refresh";

const EMPTY: InboxSnapshot = { rows: [], pendingRequests: 0 };

function deps(overrides: Partial<InboxRefreshDeps> = {}) {
  const spies = {
    syncInbox: vi.fn(async () => undefined),
    canSync: vi.fn(() => true),
    loadRows: vi.fn(async () => EMPTY),
    onRows: vi.fn(),
    onError: vi.fn(),
    onLoading: vi.fn(),
  };
  return { spies, deps: { ...spies, ...overrides } satisfies InboxRefreshDeps };
}

describe("createInboxRefresher", () => {
  it("refresh syncs then reads local storage", async () => {
    const { spies, deps: d } = deps();
    await createInboxRefresher(d).refresh();
    expect(spies.syncInbox).toHaveBeenCalledTimes(1);
    expect(spies.loadRows).toHaveBeenCalledTimes(1);
    expect(spies.onRows).toHaveBeenCalledWith(EMPTY);
    expect(spies.onLoading.mock.calls).toEqual([[true], [false]]);
  });

  it("refresh skips the sync when syncing is not possible", async () => {
    const { spies, deps: d } = deps({ canSync: () => false });
    await createInboxRefresher(d).refresh();
    expect(spies.syncInbox).not.toHaveBeenCalled();
    expect(spies.loadRows).toHaveBeenCalledTimes(1);
  });

  it("refresh still reads local storage when the sync fails", async () => {
    const { spies, deps: d } = deps({
      syncInbox: async () => {
        throw new Error("offline");
      },
    });
    await createInboxRefresher(d).refresh();
    expect(spies.loadRows).toHaveBeenCalledTimes(1);
    expect(spies.onError).not.toHaveBeenCalled();
  });

  it("reload never syncs", async () => {
    const { spies, deps: d } = deps();
    await createInboxRefresher(d).reload();
    expect(spies.syncInbox).not.toHaveBeenCalled();
    expect(spies.loadRows).toHaveBeenCalledTimes(1);
    expect(spies.onLoading).toHaveBeenCalledWith(false);
  });

  it("reload reports a storage failure", async () => {
    const failure = new Error("db closed");
    const { spies, deps: d } = deps({
      loadRows: async () => {
        throw failure;
      },
    });
    await createInboxRefresher(d).reload();
    expect(spies.onError).toHaveBeenCalledWith(failure);
    expect(spies.onLoading).toHaveBeenCalledWith(false);
  });

  it("terminates when the sync announcement feeds back into the refresher", async () => {
    // syncInbox() ends by announcing that it synced. Wiring that announcement
    // back to refresh() is what spun forever and starved the main thread, so the
    // listener path must settle after exactly one sync.
    const wired: { refresher?: ReturnType<typeof createInboxRefresher> } = {};
    const syncInbox = vi.fn(async () => {
      await wired.refresher?.reload();
    });
    const { spies, deps: d } = deps({ syncInbox });
    wired.refresher = createInboxRefresher(d);

    await wired.refresher.refresh();

    expect(syncInbox).toHaveBeenCalledTimes(1);
    expect(spies.loadRows).toHaveBeenCalledTimes(2);
  });
});
