# Architecture decisions — Hypercolor chat

These ADRs are design. They do not change protocol or product code. No item is Accepted until a later change names a wire revision and lands with proofs.

| ADR | Title | Status | Owns |
|---|---|---|---|
| [0001](0001-group-as-pubky.md) | Group as a Pubky — Private Messaging Only | Proposed — 2026-08-31 (amended same day) | Private DMs (stay Encrypted Links) and private groups (group key, per-member prefixes, signed encrypted DAG). Session revocation **unavailable** in v1. |
| [0002](0002-public-chat-as-graph.md) | Public Chat as Posts, Tags, and Feeds | Proposed — 2026-08-31 | Public rooms as `PubkyAppPost` + `PubkyAppTag` + `PubkyAppFeed`. Drops `/pub/hypercolor.app/v1/public-channels/` and `chat.public.message.v0`. Follows import opt-in, read-only. nexus-scout opt-in, discovery-only. |
| [0003](0003-chat-architecture-roadmap.md) | Unified Chat Architecture Roadmap | Proposed — 2026-08-31 (amended by 0004) | One ordered sequence. Items 1–3 (follows import, tag-channel view, username search) are cheap, need no protocol change, and must not wait on 0001. Items 3a–3d come from 0004. |
| [0004](0004-open-inbox-drop-point.md) | Open Inbox — a Sealed Drop Point for First Contact | Proposed — 2026-08-31, revised same day after an external security review returned DO-NOT-SHIP | First contact from a stranger. Sealed **pointer** (not a message) to an InboxKey KID, held by a capped drop relay. Accept gate unchanged. Message bodies never leave the pairwise DH-derived path. Carries an audit-response section closing every review finding as fixed, waived with a named residual holder, or rejected on the source. |

Supporting analysis (not an ADR): [../graph-utilisation-review.md](../graph-utilisation-review.md).

## Two-domain architecture

```
                    public graph (posts, tags, follows, feeds)
                    ─────────────────────────────────────────
  discovery  →  tag label + feed          moderation → tags, mutes, reach
  utterance  →  PubkyAppPost              scout / Nexus → accelerator

                    private / hosted
                    ─────────────────────────────────────────
  DM         →  Encrypted Link PAM        (already shipped)
  first
  contact    →  sealed drop pointer → request queue (ADR 0004)
  private
  group      →  group-as-pubky + caps
               + signed DAG + local index (ADR 0001)
```

The line between the two blocks is the privacy boundary. It must be explicit in the product. Nexus and nexus-scout do not model DMs. Collapsing the domains deanonymises the messenger.

## Namespace rule

| Prefix | Domain |
|---|---|
| `/pub/pubky.app/posts\|tags\|feeds\|files\|blobs\|follows\|profile.json` | Public (0002) |
| `/pub/hypercolor.app/v1/group/` | Private groups (0001). Encrypted. Unindexed **by design**. |
| `/pub/hypercolor.app/v1/inbox/v1.json` | Open-inbox descriptor (0004). Deliberately world-readable: a stranger must be able to find it. Absent = inbox closed. |
| `/pub/hypercolor.app/v1/attachments/`, `/backup/` | Private app objects. Keep. |
| `/pub/hypercolor.app/v1/public-channels/` | **Dropped.** |
| `/pub/paykit/` | Encrypted Link transport. |

Writes outside `/pub/` are forbidden by the homeserver. Private data is encrypted inside world-readable space.

## Implementation

Privacy-sensitive roadmap items (tagged in 0003) need a Kimi sensitive-area audit before merge. Do not implement 0001 protocol in the same change that accepts these documents. Wire-copied files under the mobile pin cannot grow v1 kinds without a pin bump coordinated with `BitcoinErrorLog/hypercolor`.

ADR 0004 additionally needs the vendored `paykit-wasm` **pin propagated, not rebuilt.** This tree's `vendor/paykit-wasm/` is `0.1.0-rc44` and exports `sb2Decrypt` / `sb2VerifySignature` / `x25519GenerateKeypair` / `generateNoiseSecretKey` / `noisePublicKeyFromSecret` but **not** `sb2Encrypt`, `sb2Sign`, or `computeInboxKid`. Those three already exist in the official `BitcoinErrorLog/paykit-rs-official` build at HEAD `a2999bf` (`0.1.0-rc47`), so the task is copying `paykit-wasm/pkg` in and updating `PROVENANCE.md`. Phase A's descriptor and challenge-decrypt work runs on the current rc44 pin.

Two prerequisites of ADR 0004 Phase B live in `BitcoinErrorLog/hypercolor` and are blocking, not follow-ups: `src/services/link/wotGate.ts` must be synced to the upstream `a373cd1` accept policy (this tree's copy is pin `c7157aaa` and still auto-accepts on follow / mutual / manual add), and `routeHeldGroupInbound` must stop applying a pending stranger's group `op: 'create'`. See ADR 0004 §Audit response, F-13 and F-15.
