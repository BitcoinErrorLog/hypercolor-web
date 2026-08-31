// Copied from BitcoinErrorLog/hypercolor src/services/link/wotGate.ts
// pin c7157aaa1b338dd1d8545e82f639007cba945631
import { WOT_AUTO_ACCEPT_TRUST_THRESHOLD } from '../../flags/config';

/**
 * Inbound Encrypted Link gate.
 *
 * This is a REQUEST filter, not a delivery block. A conversation that is
 * already accepted, or that already has routed `link_messages` for this
 * owner+peer, continues to receive. Trust scores never block delivery for
 * those peers (see TrustEngine).
 *
 * Product policy: a stranger's first message never auto-opens an encrypted
 * conversation. Follow, mutual follow, and manual add are ranking / badge
 * signals only (TrustEngine, contacts-sort). They must not gate accept.
 *
 * The only auto-accept path is compatibility for a conversation that is
 * already underway: routed `link_messages` rows already exist for this
 * owner+peer. That is not a trust signal. It exists so existing users do
 * not see active chats fall back into the request queue after a wedged-link
 * wipe or a policy change. Name: `hasPriorRoutedConversation`.
 *
 * | follow / mutual / manual add | prior routed msgs | decision     |
 * |------------------------------|-------------------|--------------|
 * | *                            | > 0               | auto-accept  |
 * | *                            | 0                 | request      |
 *
 * AppConfig.getWotAutoAcceptTrustThreshold() remains wired so a stored
 * override is read; it is NOT used to auto-accept anyone.
 */
export type WotDecision = 'auto-accept' | 'request';

export type WotInput = {
  isMutual: boolean;
  isFollowing: boolean;
  addedManually: boolean;
  /**
   * Compatibility only: routed `link_messages` already exist for this
   * owner+peer. Not a follow/trust bit.
   */
  hasPriorRoutedConversation: boolean;
};

export function resolveWotAutoAcceptThreshold(): number {
  try {
    // Lazy so unit tests that import this file do not load react-native-mmkv.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const flags = require('../../flags') as {
      AppConfig: { getWotAutoAcceptTrustThreshold: () => number };
    };
    return flags.AppConfig.getWotAutoAcceptTrustThreshold();
  } catch {
    return WOT_AUTO_ACCEPT_TRUST_THRESHOLD;
  }
}

export function classifyInboundPeer(
  input: WotInput,
  threshold: number = resolveWotAutoAcceptThreshold(),
): WotDecision {
  void threshold;
  if (input.hasPriorRoutedConversation) return 'auto-accept';
  return 'request';
}

export function wotInputFromContact(
  contact: {
    isMutual: boolean;
    isFollowing: boolean;
    addedManually: boolean;
  } | null,
  hasPriorRoutedConversation = false,
): WotInput {
  if (!contact) {
    return {
      isMutual: false,
      isFollowing: false,
      addedManually: false,
      hasPriorRoutedConversation,
    };
  }
  return {
    isMutual: contact.isMutual,
    isFollowing: contact.isFollowing,
    addedManually: contact.addedManually,
    hasPriorRoutedConversation,
  };
}
