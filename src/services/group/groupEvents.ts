// Copied from BitcoinErrorLog/hypercolor src/services/group/groupEvents.ts
// pin 6185a6a8e6bf3a52831515cb85131a7020704396
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
