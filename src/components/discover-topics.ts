import type { NexusHotTag } from "@/services/nexus/NexusDiscoveryClient";
import type { TagChannelLoad } from "@/services/nexus/tagChannel";

export const DISCOVER_INDEX_ERROR = "Could not reach the public index.";

export type DiscoverTopicsView = {
  tags: NexusHotTag[];
  loaded: boolean;
  error: string | null;
};

export function initialDiscoverTopicsView(): DiscoverTopicsView {
  return { tags: [], loaded: false, error: null };
}

export function discoverTopicsAfterLoad(result: TagChannelLoad): DiscoverTopicsView {
  if (!result.ok) {
    return { tags: [], loaded: false, error: DISCOVER_INDEX_ERROR };
  }
  return { tags: result.tags, loaded: true, error: null };
}

export function createDiscoverTopicsLoader(loadDirectory: () => Promise<TagChannelLoad>) {
  let fetches = 0;
  return {
    fetches(): number {
      return fetches;
    },
    async load(): Promise<DiscoverTopicsView> {
      fetches += 1;
      return discoverTopicsAfterLoad(await loadDirectory());
    },
  };
}
