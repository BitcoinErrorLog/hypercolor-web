import { PROFILE_HYDRATE_CONCURRENCY } from "@/flags/config";
import { mapPool } from "@/lib/map-pool";
import { normalizeTagLabel } from "@/lib/tag-channel";
import type { NexusDiscoveryApi, NexusHotTag, NexusPublicPost } from "./NexusDiscoveryClient";
import {
  HOT_TAGS_DEFAULT_LIMIT,
  NexusDiscoveryClient,
  POSTS_BY_TAG_DEFAULT_LIMIT,
} from "./NexusDiscoveryClient";

export type TagChannelLoad =
  | { ok: true; tags: NexusHotTag[] }
  | { ok: false; kind: "network" | "http" | "decode"; message: string };

export type TagTimelineLoad =
  | { ok: true; tag: string; posts: NexusPublicPost[]; unavailable: number }
  | { ok: false; kind: "invalid" | "network" | "http" | "decode"; message: string };

export function createTagChannelReader(api: NexusDiscoveryApi) {
  return {
    async loadDirectory(): Promise<TagChannelLoad> {
      const result = await api.hotTags();
      if (!result.ok) {
        return { ok: false, kind: result.kind, message: result.message };
      }
      return { ok: true, tags: result.value.slice(0, HOT_TAGS_DEFAULT_LIMIT) };
    },

    async loadTimeline(rawTag: string): Promise<TagTimelineLoad> {
      const tag = normalizeTagLabel(rawTag);
      if (!tag) {
        return { ok: false, kind: "invalid", message: "That is not a usable topic label." };
      }
      const keys = await api.searchPostsByTag(tag);
      if (!keys.ok) {
        return { ok: false, kind: keys.kind, message: keys.message };
      }
      const fetched = await mapPool(
        keys.value.slice(0, POSTS_BY_TAG_DEFAULT_LIMIT),
        PROFILE_HYDRATE_CONCURRENCY,
        (row) => api.post(row.author, row.postId),
      );
      const posts: NexusPublicPost[] = [];
      let unavailable = 0;
      for (const item of fetched) {
        if (item.ok && item.value) posts.push(item.value);
        else unavailable += 1;
      }
      return { ok: true, tag, posts, unavailable };
    },
  };
}

export const TagChannelReader = createTagChannelReader(NexusDiscoveryClient);
