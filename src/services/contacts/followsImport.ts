import { PROFILE_HYDRATE_CONCURRENCY } from "@/flags/config";
import { mapPool } from "@/lib/map-pool";
import type { NexusClientApi, NexusResult } from "@/services/NexusClient";
import { StorageService } from "@/services/StorageService";
import type { Contact, PubkyKey } from "@/types";
import { isFollowsImportEnabled } from "./followsImportPreference";
import { createHomeserverFollows, defaultHomeserverFollowsIo } from "./homeserverFollows";

/**
 * Opt-in, read-only import of `/pub/pubky.app/follows/`.
 *
 * - Off by default. Callers must check the preference; this function also
 *   no-ops if the preference is off so a stray call cannot hydrate.
 * - Never PUTs a follow. Adding a Hypercolor contact stays `addManualContact`.
 * - Follows are suggestions + relationship flags, not the contact roster.
 * - Strangers who only follow the user are not added.
 * - A Nexus following hit is not enough: each peer needs a homeserver
 *   follow document, or the homeserver directory listing itself.
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

export type FollowsImportDeps = {
  isEnabled: (ownerPubky: PubkyKey) => boolean;
  listOwnFollows: ReturnType<typeof createHomeserverFollows>["listOwnFollows"];
  confirmFollow: ReturnType<typeof createHomeserverFollows>["confirmFollow"];
  following: NexusClientApi["following"];
  followers: NexusClientApi["followers"];
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

export function createFollowsImporter(deps: FollowsImportDeps) {
  return {
    async importFollows(ownerPubky: PubkyKey | null): Promise<FollowsImportResult> {
      if (!ownerPubky) return { ok: true, skipped: true, reason: "no-owner" };
      if (!deps.isEnabled(ownerPubky)) return { ok: true, skipped: true, reason: "opt-in-off" };

      const listed = await deps.listOwnFollows(ownerPubky);
      let confirmed: PubkyKey[] = [];
      let source: FollowsImportSource = "homeserver";

      if (listed.ok) {
        confirmed = listed.pubkys.slice(0, FOLLOWS_IMPORT_CAP);
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
        const checks = await mapPool(
          nexus.value.filter((peer) => peer !== ownerPubky).slice(0, FOLLOWS_IMPORT_CAP),
          PROFILE_HYDRATE_CONCURRENCY,
          (peer) => deps.confirmFollow(ownerPubky, peer),
        );
        confirmed = nexus.value.filter((peer, index) => checks[index] === true);
      }

      const followersResult = emptyOn404(
        await deps.followers(ownerPubky, { skip: 0, limit: FOLLOWS_IMPORT_CAP }),
      );
      const followersComplete = followersResult.ok;
      const followerSet = new Set(followersComplete ? followersResult.value : []);

      const confirmedSet = new Set(confirmed);
      const existing = await deps.getAllContacts(ownerPubky);
      const existingSet = new Set(existing.map((row) => row.pubky));
      const now = Date.now();
      let updatedCount = 0;
      let suggestionCount = 0;

      for (const contact of existing) {
        const isFollowing = confirmedSet.has(contact.pubky);
        const isFollower = followersComplete ? followerSet.has(contact.pubky) : contact.isFollower;
        const isMutual = isFollowing && isFollower;
        if (
          contact.isFollowing === isFollowing &&
          contact.isFollower === isFollower &&
          contact.isMutual === isMutual
        ) {
          continue;
        }
        await deps.setContactRelationshipFlags(ownerPubky, contact.pubky, {
          isFollowing,
          isFollower,
          isMutual,
        });
        updatedCount += 1;
      }

      for (const peer of confirmed) {
        if (existingSet.has(peer) || peer === ownerPubky) continue;
        const isFollower = followersComplete && followerSet.has(peer);
        await deps.upsertContact({
          pubky: peer,
          ownerPubky,
          trustScore: 0,
          isFollowing: true,
          isFollower,
          isMutual: isFollower,
          addedManually: false,
          firstSeenAt: now,
        });
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
  };
}

export function defaultFollowsImporter(): ReturnType<typeof createFollowsImporter> {
  const hs = createHomeserverFollows(defaultHomeserverFollowsIo());
  return createFollowsImporter({
    isEnabled: isFollowsImportEnabled,
    listOwnFollows: (owner) => hs.listOwnFollows(owner),
    confirmFollow: (owner, peer) => hs.confirmFollow(owner, peer),
    following: (pubky, query) => {
      const { createNexusClient } = requireNexus();
      return createNexusClient().following(pubky, query);
    },
    followers: (pubky, query) => {
      const { createNexusClient } = requireNexus();
      return createNexusClient().followers(pubky, query);
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
