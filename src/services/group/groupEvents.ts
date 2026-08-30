// Copied from BitcoinErrorLog/hypercolor src/services/group/groupEvents.ts
// pin c7157aaa1b338dd1d8545e82f639007cba945631
import type { PubkyKey } from '../../types';

export type GroupEventListener = (ownerPubky: PubkyKey, channelId: string) => void;

const listeners = new Set<GroupEventListener>();

export function subscribeGroupEvents(listener: GroupEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyGroupEvent(ownerPubky: PubkyKey, channelId: string): void {
  for (const listener of listeners) {
    try {
      listener(ownerPubky, channelId);
    } catch {
      // UI refresh must not fail inbound routing.
    }
  }
}
