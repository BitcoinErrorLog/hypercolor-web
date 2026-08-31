import { PROFILE_HYDRATE_CONCURRENCY } from "@/flags/config";
import { mapPool } from "@/lib/map-pool";
import type { NexusDiscoveryApi } from "@/services/nexus/NexusDiscoveryClient";
import { NexusDiscoveryClient } from "@/services/nexus/NexusDiscoveryClient";
import type { PubkyKey } from "@/types";
import { parsePubky } from "@/utils/pubkyId";

export const USERNAME_SEARCH_MIN_CHARS = 2;
export const USERNAME_SEARCH_MAX_CHARS = 32;
export const USERNAME_SEARCH_LIMIT = 8;

export type UsernameSearchHit = {
  pubky: PubkyKey;
  name: string | null;
  bio: string | null;
};

export type UsernameSearchResult =
  | { ok: true; kind: "pubky"; pubky: PubkyKey }
  | { ok: true; kind: "matches"; query: string; hits: UsernameSearchHit[] }
  | { ok: false; reason: "empty" | "short" | "long" | "invalid" | "nexus"; message: string };

export type UsernameSearchDeps = {
  searchUsersByName: NexusDiscoveryApi["searchUsersByName"];
  user: (pubky: PubkyKey) => Promise<{
    ok: boolean;
    value?: { details?: { name?: string; bio?: string } };
  }>;
};

const UNSAFE_PREFIX = /[/?#&\\]/;

export function createUsernameSearch(deps: UsernameSearchDeps) {
  return {
    async search(raw: string): Promise<UsernameSearchResult> {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return { ok: false, reason: "empty", message: "Enter a username or paste a pubky." };
      }
      const asPubky = parsePubky(trimmed);
      if (asPubky) return { ok: true, kind: "pubky", pubky: asPubky };
      if (trimmed.length < USERNAME_SEARCH_MIN_CHARS) {
        return {
          ok: false,
          reason: "short",
          message: `Type at least ${USERNAME_SEARCH_MIN_CHARS} characters, or paste a pubky.`,
        };
      }
      if (trimmed.length > USERNAME_SEARCH_MAX_CHARS) {
        return { ok: false, reason: "long", message: "That username is too long to search." };
      }
      if (UNSAFE_PREFIX.test(trimmed) || trimmed.includes("..")) {
        return { ok: false, reason: "invalid", message: "That is not a username." };
      }

      const found = await deps.searchUsersByName(trimmed, {
        skip: 0,
        limit: USERNAME_SEARCH_LIMIT,
      });
      if (!found.ok) {
        return {
          ok: false,
          reason: "nexus",
          message: "The public index is unreachable. Paste a pubky instead.",
        };
      }

      const hits = await mapPool(found.value, PROFILE_HYDRATE_CONCURRENCY, async (pubky) => {
        const profile = await deps.user(pubky);
        const name = profile.ok ? profile.value?.details?.name?.trim() ?? null : null;
        const bio = profile.ok ? profile.value?.details?.bio?.trim() ?? null : null;
        return {
          pubky,
          name: name && name.length > 0 ? name : null,
          bio: bio && bio.length > 0 ? bio : null,
        };
      });

      return { ok: true, kind: "matches", query: trimmed, hits };
    },
  };
}

export function defaultUsernameSearch(): ReturnType<typeof createUsernameSearch> {
  return createUsernameSearch({
    searchUsersByName: (prefix, query) => NexusDiscoveryClient.searchUsersByName(prefix, query),
    user: async (pubky) => {
      const { createNexusClient } = requireNexus();
      return createNexusClient().user(pubky);
    },
  });
}

function requireNexus(): { createNexusClient: typeof import("@/services/NexusClient").createNexusClient } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/services/NexusClient") as {
    createNexusClient: typeof import("@/services/NexusClient").createNexusClient;
  };
}

export const UsernameSearch = defaultUsernameSearch();
