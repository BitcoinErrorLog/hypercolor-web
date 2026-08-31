import { PROFILE_HYDRATE_CONCURRENCY } from "@/flags/config";
import { mapPool } from "@/lib/map-pool";
import type { NexusClientApi, NexusResult } from "@/services/NexusClient";
import { StorageService } from "@/services/StorageService";
import type { Contact, PubkyKey } from "@/types";
import { parsePubky } from "@/utils/pubkyId";
import {
  followsImportGeneration,
  isFollowsImportEnabled,
} from "./followsImportPreference";
import { createHomeserverFollows, defaultHomeserverFollowsIo } from "./homeserverFollows";

/**
 * Opt-in, read-only import of `/pub/pubky.app/follows/`.
 *
 * - Off by default. Callers must check the preference; this function also
 *   no-ops if the preference is off so a stray call cannot hydrate.
 * - Never PUTs a follow. Adding a Hypercolor contact stays `addManualContact`.
 * - Follows are suggestions + the `isFollowing` flag, not the contact roster.
 * - Strangers who only follow the user are not added.
 * - A Nexus following hit is not enough: each peer needs a homeserver
 *   follow document, or the homeserver directory listing itself.
 * - Nexus follower / mutual claims are display-only elsewhere and are never
 *   written here. `isFollower` / `isMutual` are cleared on import and disable
 *   so they cannot become an auto-accept input.
 */

export const FOLLOWS_IMPORT_CAP = 200;

export type FollowsImportSource = "homeserver" | "nexus-confirmed";

export type FollowsImportResult =
  | {
      ok: true;
      skipped: false;
      source: FollowsImportSource;
      confirmedCount: number;
      suggestionCount: number;
      updatedCount: number;
    }
  | { ok: true; skipped: true; reason: "opt-in-off" | "no-owner" }
  | { ok: false; message: string };

export type FollowsImportClearResult =
  | { ok: true; clearedCount: number }
  | { ok: true; skipped: true; reason: "no-owner" };

export type FollowsImportDeps = {
  isEnabled: (ownerPubky: PubkyKey) => boolean;
  importGeneration: (ownerPubky: PubkyKey) => number;
  listOwnFollows: ReturnType<typeof createHomeserverFollows>["listOwnFollows"];
  confirmFollow: ReturnType<typeof createHomeserverFollows>["confirmFollow"];
  following: NexusClientApi["following"];
  getAllContacts: (ownerPubky: PubkyKey) => Promise<Contact[]>;
  upsertContact: (contact: Contact) => Promise<void>;
  setContactRelationshipFlags: (
    ownerPubky: PubkyKey,
    pubky: PubkyKey,
    flags: { isFollowing: boolean; isFollower: boolean; isMutual: boolean },
  ) => Promise<void>;
};

function emptyOn404(result: NexusResult<PubkyKey[]>): NexusResult<PubkyKey[]> {
  if (!result.ok && result.kind === "http" && result.status === 404) {
    return { ok: true, value: [] };
  }
  return result;
}

function validFollowPeers(raw: readonly string[], ownerPubky: PubkyKey): PubkyKey[] {
  const out: PubkyKey[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const peer = parsePubky(item);
    if (!peer || peer === ownerPubky || seen.has(peer)) continue;
    seen.add(peer);
    out.push(peer);
    if (out.length >= FOLLOWS_IMPORT_CAP) break;
  }
  return out;
}

const CLEARED_FLAGS = { isFollowing: false, isFollower: false, isMutual: false } as const;

function createOwnerSerialQueue() {
  const tails = new Map<string, Promise<void>>();
  return function runSerialized<T>(ownerPubky: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(ownerPubky) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    tails.set(
      ownerPubky,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  };
}

export function createFollowsImporter(deps: FollowsImportDeps) {
  const runSerialized = createOwnerSerialQueue();

  function stillCurrent(ownerPubky: PubkyKey, generation: number): boolean {
    return deps.isEnabled(ownerPubky) && deps.importGeneration(ownerPubky) === generation;
  }

  return {
    async importFollows(ownerPubky: PubkyKey | null): Promise<FollowsImportResult> {
      if (!ownerPubky) return { ok: true, skipped: true, reason: "no-owner" };
      if (!deps.isEnabled(ownerPubky)) return { ok: true, skipped: true, reason: "opt-in-off" };
      const generation = deps.importGeneration(ownerPubky);

      const listed = await deps.listOwnFollows(ownerPubky);
      let confirmed: PubkyKey[] = [];
      let source: FollowsImportSource = "homeserver";

      if (listed.ok) {
        confirmed = validFollowPeers(listed.pubkys, ownerPubky);
      } else {
        source = "nexus-confirmed";
        const nexus = emptyOn404(await deps.following(ownerPubky, { skip: 0, limit: FOLLOWS_IMPORT_CAP }));
        if (!nexus.ok) {
          return {
            ok: false,
            message:
              "Could not read your pubky.app follows from the homeserver or the public index.",
          };
        }
        const candidates = validFollowPeers(nexus.value, ownerPubky);
        const checks = await mapPool(
          candidates,
          PROFILE_HYDRATE_CONCURRENCY,
          (peer) => deps.confirmFollow(ownerPubky, peer),
        );
        confirmed = candidates.filter((_peer, index) => checks[index] === true);
      }

      if (!stillCurrent(ownerPubky, generation)) {
        return { ok: true, skipped: true, reason: "opt-in-off" };
      }

      const confirmedSet = new Set(confirmed);
      const existing = await deps.getAllContacts(ownerPubky);
      const existingSet = new Set(existing.map((row) => row.pubky));
      const now = Date.now();
      let updatedCount = 0;
      let suggestionCount = 0;

      for (const contact of existing) {
        const isFollowing = confirmedSet.has(contact.pubky);
        if (
          contact.isFollowing === isFollowing &&
          contact.isFollower === false &&
          contact.isMutual === false
        ) {
          continue;
        }
        const wrote = await runSerialized(ownerPubky, async () => {
          if (!stillCurrent(ownerPubky, generation)) return false;
          await deps.setContactRelationshipFlags(ownerPubky, contact.pubky, {
            isFollowing,
            isFollower: false,
            isMutual: false,
          });
          if (stillCurrent(ownerPubky, generation)) return true;
          await deps.setContactRelationshipFlags(ownerPubky, contact.pubky, CLEARED_FLAGS);
          return false;
        });
        if (!wrote) return { ok: true, skipped: true, reason: "opt-in-off" };
        updatedCount += 1;
      }

      for (const peer of confirmed) {
        if (existingSet.has(peer) || peer === ownerPubky) continue;
        const wrote = await runSerialized(ownerPubky, async () => {
          if (!stillCurrent(ownerPubky, generation)) return false;
          await deps.upsertContact({
            pubky: peer,
            ownerPubky,
            trustScore: 0,
            isFollowing: true,
            isFollower: false,
            isMutual: false,
            addedManually: false,
            firstSeenAt: now,
          });
          if (stillCurrent(ownerPubky, generation)) return true;
          await deps.setContactRelationshipFlags(ownerPubky, peer, CLEARED_FLAGS);
          return false;
        });
        if (!wrote) return { ok: true, skipped: true, reason: "opt-in-off" };
        suggestionCount += 1;
      }

      return {
        ok: true,
        skipped: false,
        source,
        confirmedCount: confirmed.length,
        suggestionCount,
        updatedCount,
      };
    },

    async clearImportedRelationshipFlags(
      ownerPubky: PubkyKey | null,
    ): Promise<FollowsImportClearResult> {
      if (!ownerPubky) return { ok: true, skipped: true, reason: "no-owner" };
      return runSerialized(ownerPubky, async () => {
        const existing = await deps.getAllContacts(ownerPubky);
        let clearedCount = 0;
        for (const contact of existing) {
          if (!contact.isFollowing && !contact.isFollower && !contact.isMutual) continue;
          await deps.setContactRelationshipFlags(ownerPubky, contact.pubky, CLEARED_FLAGS);
          clearedCount += 1;
        }
        return { ok: true, clearedCount };
      });
    },
  };
}

export function defaultFollowsImporter(): ReturnType<typeof createFollowsImporter> {
  const hs = createHomeserverFollows(defaultHomeserverFollowsIo());
  return createFollowsImporter({
    isEnabled: isFollowsImportEnabled,
    importGeneration: followsImportGeneration,
    listOwnFollows: (owner) => hs.listOwnFollows(owner),
    confirmFollow: (owner, peer) => hs.confirmFollow(owner, peer),
    following: (pubky, query) => {
      const { createNexusClient } = requireNexus();
      return createNexusClient().following(pubky, query);
    },
    getAllContacts: (owner) => StorageService.getAllContacts(owner),
    upsertContact: (contact) => StorageService.upsertContact(contact),
    setContactRelationshipFlags: (owner, pubky, flags) =>
      StorageService.setContactRelationshipFlags(owner, pubky, flags),
  });
}

function requireNexus(): { createNexusClient: typeof import("@/services/NexusClient").createNexusClient } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/services/NexusClient") as {
    createNexusClient: typeof import("@/services/NexusClient").createNexusClient;
  };
}

export const FollowsImporter = defaultFollowsImporter();
