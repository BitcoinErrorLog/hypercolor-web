# ADR 0004: Open Inbox — a Sealed Drop Point for First Contact

## Status

Proposed — 2026-08-31. **Revised 2026-08-31** in response to an external security review of the first revision, which returned **DO-NOT-SHIP**. Every finding is closed in §Audit response: fixed, waived with a named residual holder and unacceptability condition, or rejected with contradicting evidence. Two of the review's own claims were rejected on the source (F-11, F-13), and one new finding (F-15) was found while closing its open caveat. Still Proposed: this remains design, and nothing here is Accepted until an implementation lands with the phase proofs.

The product decision is made: **open the inbox.** A stranger must be able to land in the recipient's message-request queue. This ADR designs the mechanism and states its costs. It does not relitigate the decision and it does not implement it.

Scope: **first contact only.** Everything after accept stays exactly as it is today — Encrypted Link, Noise XX, Private Application Messages. This ADR adds no message transport, no new place for message bodies, and no change to `chat.message.v0`.

Companions: [ADR 0001](0001-group-as-pubky.md) (private DMs and groups), [ADR 0002](0002-public-chat-as-graph.md) (public rooms). Execution order: [ADR 0003](0003-chat-architecture-roadmap.md), amended by this document.

## Context

### The defect

`LinkService.syncInbox` probes a candidate set. `collectInboxCandidates` builds that set from local contacts and local links only:

```ts
/**
 * Known counterparties we can probe. Encrypted Links have no inbox
 * enumeration — inbound from a stranger is invisible until their pubky
 * appears in this set (follow / follower / friend / manual add / existing
 * link peer).
 */
async function collectInboxCandidates(ownerPubky: PubkyKey): Promise<PubkyKey[]> {
  const [contacts, links] = await Promise.all([
    StorageService.getAllContacts(ownerPubky),
    StorageService.getAllLinks(ownerPubky),
  ]);
  // ... union of contact.pubky and link.peerPubky
}
```

(`BitcoinErrorLog/hypercolor` `src/services/link/LinkService.ts`, pin `a373cd1`.)

Three consequences, all real:

1. **A stranger cannot reach you.** Not "is filtered" — is *invisible*. Nothing polls their path.
2. **The sender gets no failure signal.** The sender's runtime completes its own write, marks the item `sent`, and shows a normal message. The recipient never learns it exists. This is the worst failure mode a messenger can have, because both sides believe they succeeded.
3. **Follows import is opt-in** (ADR 0003 item 1), so a user who never enables it can be reached only by manual add or an existing link.

### The accept gate is *not* the defect

Upstream tightened `classifyInboundPeer` before this ADR was written:

```ts
export function classifyInboundPeer(input: WotInput, threshold = ...): WotDecision {
  if (input.hasPriorRoutedConversation) return 'auto-accept';
  return 'request';
}
```

(`src/services/link/wotGate.ts`, pin `a373cd1`. Follow, mutual follow, and manual add are ranking/badge signals and "MUST NOT be re-introduced as accept conditions.")

That gate is the spam defense and this ADR keeps it unchanged. Opening the inbox means opening the **queue**, not the conversation. Nothing in this document auto-accepts anyone.

#### This tree's gate is the older, wider one, and that is a Phase B blocker

Re-verified byte-for-byte, because an audit of this ADR asserted the opposite:

- `src/services/link/wotGate.ts` in **this** tree carries the header `pin c7157aaa1b338dd1d8545e82f639007cba945631`, and its `classifyInboundPeer` (lines 63-71) reads `if (input.isMutual || input.isFollowing || input.addedManually) return 'auto-accept';` before falling through to a `hasEstablishedConversation` check. Its `WotInput` field is named `hasEstablishedConversation`, not `hasPriorRoutedConversation`.
- The narrowed version quoted above is the **upstream** file at `BitcoinErrorLog/hypercolor` pin `a373cd1`, which is byte-identical to the copy the audit read. It is not what this tree ships.

So the note stands and it is not cosmetic. **On this tree as it exists, opening the inbox would auto-accept any stranger the local user happens to follow.** A drop hint names an arbitrary pubky; if that pubky is in the local contact table with `isFollowing: true` — which opt-in follows import (ADR 0003 item 1) is designed to produce in bulk from a world-readable list — the inbound handshake auto-accepts and the request queue is bypassed entirely. Follows import plus this tree's gate plus an open inbox is a stranger-to-accepted-conversation pipeline.

**Requirement:** syncing `src/services/link/wotGate.ts` to the upstream `a373cd1` policy — auto-accept on `hasPriorRoutedConversation` only, with the field renamed — is a **prerequisite of Phase B**, not a follow-up. The pin bump that carries it is the same coordinated bump §Wire-contract impact already requires. Until it lands, Phase B must not ship, and Phase A (descriptor only, nothing polls) is the only part of this ADR that is safe on the current gate.

The injunction is unchanged and restated: follow, mutual follow, and manual add are ranking and badge signals. They **MUST NOT** be re-introduced as accept conditions.

### The hard constraint: you cannot write to another user's homeserver

Verified, not assumed.

`pubky_common::capabilities::Capability` is `{ scope, actions }` where scope is a path prefix and actions are `r` (GET) and `w` (PUT/POST/DELETE). No expiry, no recipient binding, no revocation id, no append-only action (`pubky-core/pubky-common/src/capabilities.rs`).

The homeserver write path (`pubky-core/pubky-homeserver/src/client_server/layers/authz.rs` `authorize`):

1. Non-`/pub/`, non-`/session`, non-`/dav/` paths: `"Writing to directories other than '/pub/' is forbidden"`.
2. `GET`/`HEAD` under `/pub/`: allowed with no session. **World-readable.**
3. Anything else: requires a session cookie named for the pubky-host, then `if &session.user_pubkey != public_key { unauthorized }`, then a capability whose `scope` is a prefix of the path and whose actions contain `Action::Write`.

So: a session authorizes writes **only to the tenant of the key that issued it**. There is no third-party write, no delegation (`pubky-common/src/auth.rs`, version 0: the signer *is* the resource owner), and an unauthorized third-party PUT is 401 (`pubky-core/e2e/src/tests/storage.rs` `unauthorized_put_delete`).

**A stranger cannot write into your inbox by path convention. Any design that assumes otherwise is dead on arrival.**

### What the transport already does right

This matters more than it looks. Today's Encrypted Link does **not** write to the recipient. The sender writes to its **own** homeserver, at a path derived from a DH secret shared with the recipient (`paykit-rs-official/paykit-lib/src/encrypted_link/paths.rs`):

```text
dh_secret   = X25519(local_noise_seed, remote_noise_pk)
path_domain = "paykit-path-v0" || canonical(local_id, local_receiver, remote_id, remote_receiver)
write_path  = "{base}/{hex(SHA-256(path_domain || dh_secret || local_noise_pk))}"
read_path   = "{base}/{hex(SHA-256(path_domain || dh_secret || remote_noise_pk))}"
```

with `base = /pub/paykit/v0/private/{receiver_path}/messages` (`paykit-lib/src/pubky_routing.rs` `private_message_path_prefix`, `PAYKIT_PRIVATE_PATH_PREFIX`). Alice's write path is Bob's read path.

Properties that fall out of this, and that the rest of this ADR is built to preserve:

- The sender pays for the payload, on the sender's own tenant, against the sender's `user_quota_bytes` (`pubky-homeserver/src/persistence/files/user_quota_layer.rs`) and the sender homeserver's `PathLimit` rate limits (`data_directory/quota_config/path_limit.rs`).
- The path is a hash of a shared secret. An observer listing a user's `messages/` directory sees opaque directory names and opaque ciphertext. It cannot tell **who** any of it is for.
- The recipient reads over unauthenticated GET, so the sender's homeserver learns the reader's IP but not the reader's pubky.

**The missing piece is not a transport. It is enumeration.** The blob is already sitting on the sender's homeserver at a path only the two parties can compute. The recipient simply does not know which pubky to look at.

That reframes the whole problem: we need the smallest possible *pointer* — "pubky X has written to your pairwise path" — delivered to a place the recipient can enumerate. Not a message store.

### The primitive on offer: UKD / SB2 sealed blobs

`Sb2` (`pubky-crypto/src/sealed_blob_v2.rs`) is one-pass authenticated encryption to a recipient's static X25519 **InboxKey**:

- `inbox_kid = first_16_bytes(SHA256(recipient_inbox_x25519_pub))` (`Sb2Header::compute_inbox_kid`).
- Wire: `magic("SB2") || version(2) || header_len(u16) || CBOR header || ciphertext`. The header is **plaintext**.
- `aad = "pubky-envelope/v2:" || owner_peerid || canonical_path || header_no_sig` (`build_aad`). `owner_peerid` and `canonical_path` are **not transmitted** — both sides must derive them. The blob is therefore bound to an exact (storage owner, path) pair.
- Key schedule: ephemeral X25519 × static InboxKey, HKDF-SHA256, XChaCha20-Poly1305. Plaintext cap 64 KiB (`sealed_blob.rs` `MAX_PLAINTEXT_SIZE`).
- `decrypt` checks only that `inbox_kid` matches the derived key. `verify_signature` builds the verifying key from `header.sender_peerid`.

Available on every surface we ship:

| Surface | Binding | Exports |
|---|---|---|
| Web / Tauri | `paykit-rs-official/paykit-wasm/src/sb2.rs`, `src/keys.rs` | `computeInboxKid`, `sb2Encrypt`, `sb2Sign`, `sb2Decrypt`, `sb2VerifySignature`, `x25519GenerateKeypair`, plus `generateNoiseSecretKey` / `noisePublicKeyFromSecret` for the profile's ephemeral Ed25519 pair |
| iOS / Android | `pubky-noise/src/ffi/config.rs` → `generated-swift/pubky_noise.swift`, `generated-kotlin/.../pubky_noise.kt` | `computeInboxKid`, `sb2Encrypt`, `sb2Sign`, `sb2Decrypt`, `x25519GenerateKeypair` |
| Relay (Rust) | `pubky-crypto::sealed_blob_v2` directly | all of it |

**Caveat that becomes a required task — a pin bump, not a build.** The official `paykit-wasm` build is current: at `BitcoinErrorLog/paykit-rs-official` HEAD `a2999bf`, version `0.1.0-rc47`, `paykit-wasm/pkg/paykit_wasm.d.ts` already exports `computeInboxKid`, `sb2Encrypt`, `sb2Sign`, `sb2Decrypt`, `sb2VerifySignature`, `x25519GenerateKeypair`, `generateNoiseSecretKey`, and `noisePublicKeyFromSecret`. Only the pkg vendored into *this* tree is stale (`vendor/paykit-wasm/`, `0.1.0-rc44`, `PROVENANCE.md`), exporting `x25519GenerateKeypair`, `sb2VerifySignature`, `sb2Decrypt`, `generateNoiseSecretKey`, and `noisePublicKeyFromSecret` but not the three the send path needs. Propagating the rc47 pin is a prerequisite of the send path; it is not a binding project. See §Required primitives 3.

#### Does the handoff shape generalise to a standing inbox?

Partly. Honest itemisation:

- **KID derivation.** `inbox_kid` is a hash of a static X25519 public key. It is *not* per-session and *not* per-sender. Every sender who reaches one recipient uses the same KID. It is **rotatable** — `ukd::KeyBinding.inbox_keys` is a `Vec<InboxKeyEntry>` and `add_inbox_key` computes the kid — but rotation only helps if the *new* key is discoverable, and a discoverable key is by definition public. So **rotation buys revocation and epoch-bounded exposure. It does not buy unlinkability.**
- **Sender linkability.** The header carries `sender_peerid` (32-byte Ed25519) and `recipient_peerid` in **cleartext**. Used naively, an SB2 drop tells whoever stores it exactly who is messaging whom. That is strictly worse than the current closed model. It is fixable without a spec change (see the profile in §Mechanism) because `recipient_peerid` is never checked at decrypt and `sender_peerid` only has to match whatever signed the envelope.
- **Replay.** SB2 has `msg_id` (idempotency), `created_at`, `expires_at`. Nothing enforces them; the storer must.
- **Forward secrecy.** None. Sender-ephemeral × recipient-static means anyone who later obtains the InboxKey secret decrypts every retained blob for that epoch. This is the single largest crypto cost of the design and it is why the payload must be a pointer and never a body.

Verdict: **the shape is right for a pointer, wrong for a mailbox.**

## Decision

1. **First contact is a sealed pointer, not a message.** A stranger seals a ~140-byte hint — "this pubky wrote to your pairwise path" — to the recipient's InboxKey. Message bodies never enter the drop layer.
2. **The recipient advertises an inbox descriptor on their own homeserver**, at `/pub/hypercolor.app/v1/inbox/v1.json`, inside the grant this app already holds. Absence of that object means the inbox is closed, which is today's behaviour. **Opt-in by construction.**
3. **Drops are held by a KID-addressed drop relay.** New service, `BitcoinErrorLog/hypercolor-drop`. It stores fixed-size sealed blobs under an `inbox_kid`, capped and TTL'd. Reads require proof of possession of the InboxKey secret, proven with an SB2 challenge.
4. **The accept gate does not move.** A drop produces a **pending message request**. `classifyInboundPeer` is untouched. No drop, ticket, payment, PoW, tag, or follow ever auto-accepts.
5. **The hint is an unauthenticated claim and is treated as one.** It says "go look at pubky X." Any text the user sees comes from X's own DH-derived path on X's own homeserver, which only X can write. **No body, no preview, no attacker-controlled string in the request row.**
6. **The sender learns about its own submission and about world-readable facts. Nothing else.** No delivery receipt, no read receipt, no fetch flag, no ack visibility. The relay exposes no per-drop state.
7. **The closed path stays.** Manual add and follows import keep working with no relay. That fallback is the answer to relay censorship and it must never be removed.
8. **The relay is a stopgap with a named exit.** If `pubky-core` gains an append-only capability, the recipient's own homeserver becomes the drop point and the relay degrades to one optional mirror. Phase D.

### Why the pointer design wins

It is the only option that keeps every good property the current transport already has:

| Property | Pointer (chosen) | Blob relay | Sender-side publication | pkarr drop endpoint |
|---|---|---|---|---|
| Message bodies leave the pairwise path | No | **Yes** | **Yes** | Depends on endpoint |
| Forward-secrecy loss covers content | No — hints only | **Yes** | **Yes** | **Yes** |
| Unauthenticated text reaches the UI | No | **Yes** (phishing) | **Yes** | **Yes** |
| Ordering / dedupe duplicated in two transports | No | **Yes** | **Yes** | **Yes** |
| Third-party storage cost | ~1 KiB × cap | up to 64 KiB × cap | none | operator's |
| Needs a Nexus `Resource` variant | No | No | **Yes — blocked** | No |
| Needs a Ring pkarr-write capability | No | No | No | **Yes — blocked** |
| Payload cost falls on the sender's own quota | **Yes** | No | Yes | No |

## Mechanism

### 1. Inbox descriptor (recipient-published)

```
pubky://{recipient}/pub/hypercolor.app/v1/inbox/v1.json
kind: hypercolor.inbox.descriptor.v1
```

```json
{
  "version": 1,
  "kind": "hypercolor.inbox.descriptor.v1",
  "epoch": 3,
  "inbox_x25519_pub": "<64-hex>",
  "inbox_kid": "<32-hex>",
  "created_at": 1772500000,
  "drops": [
    { "url": "https://drop.hypercolor.to", "pubky": "<z-base32>" },
    { "url": "https://drop.eu.hypercolor.to", "pubky": "<z-base32>" }
  ],
  "policy": { "min_pow_bits": 20, "max_blob_bytes": 1024, "require_ticket": false },
  "retired": [{ "inbox_kid": "<32-hex>", "retired_at": 1770000000 }]
}
```

**Every timestamp in this ADR — descriptor, hint, SB2 header, PoW window, relay receipt — is Unix time in *seconds*.** This is not a free choice. `Sb2Header.created_at` and `expires_at` are documented as "Unix timestamp (seconds)" and CBOR-encoded as `uint` (`pubky-crypto/src/sealed_blob_v2.rs:70-73`), and the relay validates the descriptor-derived window against those header fields. A client that emits JavaScript `Date.now()` milliseconds into either schema produces `expires_at` values ~50,000 years in the future, which the relay's `expires_at <= now + 7 days` rule rejects as `400` with no diagnostic that points at the unit. Milliseconds are forbidden in all five schemas, and the round-trip is a Phase B proof.

- Written with `HYPERCOLOR_WRITE_CAPABILITY` = `/pub/hypercolor.app/v1/:rw` (`src/types/link.ts`). **No new Ring grant. No pkarr write. No Nexus object.**
- Read by anyone with unauthenticated `publicGet` — `GET` under `/pub/` needs no session (`authz.rs`).
- `inbox_kid` MUST equal `computeInboxKid(inbox_x25519_pub)`. A reader that finds a mismatch discards the descriptor.
- Each `drops` entry pins the relay's Ed25519 public key. It is used to verify the relay's signed acceptance receipt and as the challenge AAD owner in §5/§6. Pinning it in the descriptor means a relay cannot substitute its own key at fetch time.
- **Authenticity rests on homeserver authorization**, exactly like the existing receiver marker at `/pub/paykit/v0/{receiver_path}/receiver.json`: only a session with write on that prefix could have placed it. A malicious or compromised homeserver operator can substitute a descriptor and become the drop point for new inbound. That is not a new exposure — the receiver marker already has it — but it is not nothing, and it is why the accept gate matters.
- Deleting the object closes the inbox. `retired` lets clients discard stragglers addressed to an old KID.

### 2. The Hypercolor unlinkable SB2 profile

Same codec, fixed field discipline. No change to `pubky-crypto`.

| SB2 field | Value | Why |
|---|---|---|
| `recipient_inbox_pk` | descriptor `inbox_x25519_pub` | addressing |
| `owner_peerid` (AAD only, **untransmitted**) | the **recipient's pubky** | binds the drop to one recipient; never appears in the blob, so the relay does not see it |
| `canonical_path` (AAD only, **untransmitted**) | `/drop/v1/{inbox_kid}` | derivable by both sides from the descriptor |
| `sender_peerid` | **per-drop ephemeral Ed25519 public key** | header carries no durable sender identity |
| `sig` | `sb2Sign` with that ephemeral secret | binds header+ciphertext so a relay cannot mutate the header; `verify_signature` reads the verifying key from `sender_peerid` |
| `recipient_peerid` | **the same per-drop ephemeral public key** | the codec requires the field; it is never checked at decrypt and only enters the AAD, which the recipient recomputes from the received header |
| `context_id` | 32 random bytes | fresh per drop |
| `msg_id` | 22 random ASCII chars | relay idempotency key |
| `purpose` | `"hypercolor-intro"` | fixed, carries nothing |
| `created_at` / `expires_at` | now / now + 7 days | relay-enforced window |
| `cert_id` | absent | no AppCert path here |

**Why an ephemeral key, stated correctly.** An earlier draft justified this as a workaround — "zeros might not survive Ed25519 decompression." **That rationale is false and has been removed.** Measured directly against `ed25519-dalek` v2: `VerifyingKey::from_bytes(&[0u8; 32])` returns `Ok`, and the resulting key reports `is_weak() == true`. The all-zero `CompressedEdwardsY` decompresses because it implies `y = 0`, hence `x² = -1 (mod 2²⁵⁵-19)`, and `-1` is a quadratic residue for that prime. `pkarr::PublicKey::try_from(&[u8])` fails only when `VerifyingKey::from_bytes` fails (`pkarr-3.10.0/src/keys.rs:167-179`), so zeros parse cleanly all the way through `parse_public_key_z32_or_hex` (`paykit-wasm/src/keys.rs:79-91`).

Zeros are therefore not merely unnecessary — they are **worse than the alternative**. A small-order `sender_peerid` makes `verify_signature` (`sealed_blob_v2.rs:1106-1132`) verify against a weak key, and ed25519-dalek's non-strict `verify` accepts signatures under small-order keys. Every drop would carry a signature anyone could forge, and the relay's "`sig` present and valid" accept rule would become decoration. Nothing about the design would break loudly; it would just stop meaning anything.

The three positive reasons to use a per-drop ephemeral Ed25519 key:

1. **The signature has to be over a key nobody else controls,** or the header is malleable in transit. A relay holding a blob whose `sig` verifies under a weak key can rewrite `purpose`, `msg_id`, or `expires_at`, re-sign, and the recipient cannot tell. A fresh random key removes that with no cost.
2. **It carries no durable identity.** That is the whole sealed-sender property, and it is a positive property of a fresh key rather than an artefact of avoiding zeros.
3. **It gives the recipient a one-comparison conformance check.** `recipient_peerid` must equal `sender_peerid`; anything else is off-profile and is discarded. A drop that puts a real pubky in either field is identity-leaking and is refused before decryption is attempted.

**What the Ed25519 signature does and does not bind (kept deliberately).** In this profile the signature authenticates **nothing about the sender**. The header is already AEAD-bound through `build_aad` (`sealed_blob_v2.rs:718-726`), and the verifying key comes out of the header itself (`verify_signature` reads `header.sender_peerid`), so the check is self-referential: it proves the signer held the ephemeral secret, which the signer minted seconds earlier. We keep it anyway for two concrete reasons — it lets the relay reject header mutation with a cheap check that needs no decryption key, and it is the field a future attested-sender extension (an AppCert-bearing drop with `cert_id` populated) would use without a wire revision. **No text in this ADR, and no UI string, may present a valid `sig` as evidence about who sent a drop.**

Three consequences worth stating plainly:

- The header names neither party. **The relay does not learn the sender's pubky.** That is the sealed-sender property.
- `owner_peerid` is in the AAD but not on the wire, so a drop is cryptographically bound to one recipient without telling the relay who that is, and it cannot be re-aimed at a different recipient.
- The relay needs only `inbox_kid` and the blob bytes to enforce every accept rule. **It never has to resolve the recipient's pubky to serve a drop.** (It *can* recover it by crawling public descriptors — see the threat model. This is a "not given," not a "cannot learn.")

### 3. Drop hint (the sealed plaintext)

```json
{
  "version": 1,
  "kind": "hypercolor.inbox.hint.v1",
  "sender_pubky": "<z-base32, 52 chars>",
  "sender_receiver_path": "hypercolor/wallet",
  "created_at": 1772500000
}
```

~140 bytes. Sealed blob well under 1 KiB.

There is **no body field, and adding one is forbidden by this ADR.** The drop is authenticated only by a throwaway key, so any string in it is an unaccountable stranger's text one tap from a user's eyes. The hint's entire job is to name a pubky.

Spoofing is therefore harmless. An attacker can drop `sender_pubky = bob`, and the recipient will compute the pairwise read path with Bob and poll Bob's homeserver — where Bob wrote nothing. The request evaporates. The recipient can only ever display bytes that Bob actually placed at Bob's own DH-derived path, which requires Bob's receiver Noise secret. Impersonation buys the attacker one wasted GET.

`sender_receiver_path` is validated against `isValidReceiverPath` (`{app}/wallet|server`) before use; anything else is discarded.

### 4. Send path

1. `publicGet(recipientPubky, '/pub/hypercolor.app/v1/inbox/v1.json')`. 404 → **inbox closed**; the UI says so and offers nothing else. This is the honest replacement for today's silent success.
2. Check `inbox_kid == computeInboxKid(inbox_x25519_pub)`; reject on mismatch.
3. Run the existing `initiateHandshake` / `initiateLink` unchanged. Noise XX message 1 lands on the **sender's own** homeserver at the DH-derived write path. Nothing about this step changes.
4. Seal the hint under the profile in §2 (`sb2Encrypt` + `sb2Sign` with the ephemeral key).
5. Solve PoW over a **time-bounded** preimage:

```text
epoch_hour = header.created_at - (header.created_at mod 3600)      # Unix seconds
preimage   = "hypercolor-drop-pow/v1" || inbox_kid || BLAKE3(blob) || u64_be(epoch_hour) || nonce
target     = at least max(relay_floor, descriptor.policy.min_pow_bits) leading zero bits of BLAKE3(preimage)
```

`epoch_hour` is derived from the blob's own `created_at`, so it is not a separate transmitted field and there is nothing extra for a relay to mutate. **This stays non-interactive: there is no relay-issued challenge in the submit path.** A relay challenge would make the submit path two round trips, give the relay a per-attempt hook it does not need, and turn a stateless accept rule into stateful bookkeeping. The freshness we need is only "not stockpiled," and an hour bucket delivers it.

6. `POST /v1/drop/{inbox_kid}` to **every** URL in `drops`, with header `X-Hypercolor-Pow: {nonce}`.
7. Record per-relay outcome locally. Conversation state becomes `drop-queued` when at least one relay returned `202`.

Cost of the hour bucket: a solution is valid for at most one hour and at least zero (a drop sealed at `:59:59` is near expiry). A sender clock more than one hour off produces `400 stale-work`; the client must surface that as a clock error, not as "inbox full." Precompute is bounded to the current and next hour, and a stockpile built for a target KID is worthless the following hour. That is the whole intent — PoW remains a floor (see §Threat model), and this only removes the ability to buy the floor once and spend it forever.

### 5. Receive path

1. For each own descriptor epoch (current, plus `retired` still inside TTL), for each relay: request a challenge as specified in §5.1 below. `sb2Decrypt` the returned blob with the InboxKey secret to recover a 32-byte nonce.
2. `POST /v1/fetch/{inbox_kid}` with the nonce → the drop list.
3. For each drop: enforce size, `expires_at`, profile conformance (`recipient_peerid == sender_peerid`), and the client's own `min_pow_bits` (drops below the recipient's bar are discarded locally even if the relay accepted them); `sb2VerifySignature`; `sb2Decrypt`; parse `hypercolor.inbox.hint.v1`.
4. Add `sender_pubky` to the candidate set for this sync only. This is the change to `collectInboxCandidates` — a third source, alongside contacts and links, that does not persist a contact row. It is **not** the whole change: §5.2 adds a subtraction that the third source makes necessary.
5. The existing `syncPeerLocked` path runs untouched. `classifyInboundPeer` sees no prior routed conversation and returns `request`. The peer lands in the request queue, subject to the pending-queue cap in §5.2.
6. Ack the processed drops per §5.3. If the poll found nothing at the sender's path, the drop is acked and discarded with no contact row created.

Ordering does not exist in this layer, because the layer carries no content. All ordering, dedupe, and read-checkpoint logic stays in the PAM stream, which already dedupes by `(owner_pubky, sender_pubky, kind, event_id)`.

### 5.1 Challenge key sourcing — normative, and the obvious implementation is a total inbox takeover

Sealing a challenge to a KID requires the recipient's `inbox_x25519_pub`. A KID is `first_16_bytes(SHA256(pub))` (`sealed_blob_v2.rs:101-107`) — a truncated one-way hash. **The relay cannot derive the key from the KID.** There are exactly three ways it could obtain one, and two of them are catastrophic:

| Sourcing | Consequence |
|---|---|
| Accept a client-supplied `inbox_x25519_pub` **unchecked** | **Total inbox takeover.** An attacker posts their *own* X25519 public key against the victim's KID, receives a challenge sealed to their own key, decrypts it, and holds a valid `POST /v1/fetch` and `DELETE /v1/drop` credential for the victim's queue. They read every pending intro and delete it. The victim never learns anyone tried to contact them. Fetch-plus-delete is silent, complete, indefinite censorship of the victim's cold inbox, available to anyone who can read a world-readable descriptor. |
| Resolve the recipient's descriptor to look the key up | Wrong for a different reason. It contradicts §2's guarantee that the relay "never has to resolve the recipient's pubky to serve a drop," converts the KID→pubky map from *derivable by crawling* into a **confirmed binding the relay records on every single fetch**, and makes descriptor availability a dependency of reading your own queue. |
| Require the caller to present the key and **verify it against the KID** | Correct. Below. |

**Normative contract. `GET /v1/challenge/{inbox_kid}` is replaced by:**

```text
POST /v1/challenge/{inbox_kid}
body: { "inbox_x25519_pub": "<64-hex>" }
```

- The relay **MUST** compute `first_16_bytes(SHA256(inbox_x25519_pub))` and compare it to the `{inbox_kid}` path parameter. On mismatch it **MUST** return `400 kid-mismatch` and **MUST NOT** issue a challenge.
- The relay **MUST NOT** accept an `inbox_x25519_pub` it has not verified against the path KID, for any reason, including a cached or previously-seen key for that KID.
- The relay **MUST NOT** perform a descriptor lookup, a homeserver fetch, a pkarr resolve, or any other recipient-identity resolution in the challenge, fetch, ack, or submit path. The KID and the presented key are the only inputs.
- The relay **MUST NOT** persist `inbox_x25519_pub` beyond the lifetime of the request and its short-lived challenge cache entry (§6).
- On match, the relay seals a fresh 32-byte nonce with `sb2Encrypt` to that key, with `owner_peerid` = the relay's own pinned Ed25519 pubky and `canonical_path` = `/drop/v1/challenge/{inbox_kid}`, and returns the blob.

This makes the endpoint safely open. Presenting the key proves nothing and is not meant to — the key is world-readable in the descriptor, so anyone can request a challenge for anyone. What the mismatch check enforces is that **the challenge is only ever sealed to the one key that owns the KID**, so possession of the KID plus a public key buys nothing, and only the InboxKey *secret* holder can decrypt the nonce. The KID check is not authentication; it is the reason the missing authentication does not matter.

Binding the AAD to the relay's own pinned key keeps a challenge from one relay from being replayed against another.

### 5.2 Local state is bounded here, not by the relay's cap

The ADR previously claimed the recipient's local request state is "bounded by the 64-drop cap." **That claim was false and is withdrawn.** The 64-drop cap bounds what one relay holds *at one instant*. Step 6 deletes a processed drop, which frees the slot, so a flooder cycles: submit 64, wait for the ack, submit 64 more. Over a week at a 7-day TTL an attacker can push an unbounded number of *distinct* pubkys through a queue whose instantaneous depth never exceeds 64. Relay state is bounded; local state, as designed, was not.

Two local accumulations, both permanent, both confirmed in `BitcoinErrorLog/hypercolor` pin `a373cd1`:

1. **`message_requests` rows grow without limit.** `holdAsMessageRequest` (`src/services/link/LinkService.ts:1439`) upserts a `pending` row per new peer and never expires one. `declineMessageRequest` (`:709`) does not delete the row either — it rewrites `status: 'declined'` and that row is then read on every subsequent sync (`syncPeerLocked` `:1502`) to short-circuit the peer. Declined rows are as unbounded as pending ones.
2. **`links` rows keep the victim polling attacker homeservers forever.** This is the worse one. When a hint names a pubky that has actually published a receiver marker and written a Noise message 1 to the pairwise path, `ensureLinkLocked` probes it and `adoptInboundHandshake` (`:1200`) persists a `links` row with `status: 'handshaking'`. `collectInboxCandidates` (`:1361`) unions `StorageService.getAllLinks` into the probe set **every sync, unconditionally**. So "for this sync only" is true of the hint, and false of the state the hint causes: after one adopted handshake the attacker is a permanent candidate. Every subsequent sync issues `getReceiverMarker` plus a pairwise-path GET to the attacker's homeserver — a recurring, attacker-triggered, attacker-observable beacon that also reveals the victim's sync cadence and IP to the attacker's operator. Cost to the attacker: one marker publish and one handshake write per identity.

Three bounds, all required for Phase B:

- **`PENDING_REQUEST_CAP = 256` pending rows per owner, LRU by `createdAt`.** At the cap, a new drop-sourced pending row evicts the oldest *unviewed* pending row; a viewed-but-undecided row is never evicted by a stranger. If every row is viewed and undecided, the new drop is refused locally and the drop is acked (the queue slot is freed, the sender's `202` already went out, and no signal is returned to the sender — the accept/refuse decision is invisible to the drop layer by §Decision 6). Rationale for 256: four times the per-relay instantaneous cap, so a legitimate burst from a busy account survives, while the worst case is a bounded list a user can clear. Implemented over the existing `countPendingMessageRequests` and `listMessageRequests`.
- **`PENDING_REQUEST_TTL = 30 days` for unviewed pending rows.** An unviewed pending row older than the TTL is aged out through the same teardown `declineMessageRequest` performs — `wipeLinkState`, `deleteLinkStreamItemsForPeer`, `deleteLinkMessagesForPeer` — but **deletes the `message_requests` row instead of writing `declined`**, so age-out does not itself become an unbounded table. A row the user has opened is never aged out; expiry is for junk nobody looked at. Declined rows carry their own retention: keep `declined` for 90 days (so a re-drop inside that window stays suppressed by the existing `status === 'declined'` short-circuit), then delete.
- **Hint-sourced handshaking links are pruned out of the probe set.** `collectInboxCandidates` must **exclude** a `links` row when all of: `status !== 'established'`, `countLinkMessagesForPeer == 0`, the row's origin is a drop hint rather than a contact or a user action, and `consecutiveFailures >= INBOX_HINT_PROBE_LIMIT = 3`. That needs one new persisted column on `links` (`origin: 'hint' | 'contact' | 'manual'`), because the current row cannot tell a hint-sourced handshake from a user-initiated one and pruning the wrong one would silently break a real conversation. Rows the user acted on — accepted, declined, manually added — are never pruned by this rule. A pruned peer can return: a fresh drop re-adds them as a candidate for that sync.

Net effect: relay state is bounded by cap and TTL, local state is bounded by cap and TTL, and the recurring outbound probe to an attacker's homeserver stops after three failed syncs instead of never.

### 5.3 Acks are batched and delayed, because a prompt ack is a presence signal

Step 6 does not ack inline. The client collects the `drop_id`s it processed in a sync and issues `DELETE /v1/drop/{inbox_kid}` with the batch after a delay drawn uniformly from **0 to 900 seconds**, jittered per relay. Nothing in the client blocks on the ack; if the app closes first, the batch is retried on the next sync and the TTL is the backstop. See §Threat model → *Recipient-activity oracle* for why, and for the residual this does not remove.

### 6. Relay contract (`hypercolor-drop`)

| Route | Auth | Semantics |
|---|---|---|
| `POST /v1/drop/{inbox_kid}` | open + PoW | accept a sealed blob |
| `POST /v1/challenge/{inbox_kid}` | open + presented key verified against KID (§5.1) | SB2-sealed nonce, AAD-bound to this relay's pubky |
| `POST /v1/fetch/{inbox_kid}` | decrypted nonce | list drops |
| `DELETE /v1/drop/{inbox_kid}` | decrypted nonce | batch ack: `{ "drop_ids": [...] }`, frees quota |
| `GET /v1/info` | open | relay Ed25519 pubky, PoW floor, **and every cap in this section** |

Accept rules for `POST /v1/drop`:

- `Sb2::is_sb2` and `Sb2::decode` succeed, and `header.inbox_kid` equals the path parameter.
- Profile conformance: `header.recipient_peerid == header.sender_peerid`, `purpose == "hypercolor-intro"`, `sig` present **and valid** → else `400`. Cheap, and it keeps off-profile (identity-leaking) blobs out of the store entirely. Per §2 the valid `sig` establishes only header integrity, and the relay must not log or expose `sender_peerid` as a sender identity.
- `body.len() <= 1024` → else `413`.
- `created_at` within `[now - 2h, now + 5m]` and `expires_at` within `[created_at, now + 7 days]` → else `400`. The `created_at` lower bound exists so the PoW hour bucket below has a bounded verification window; the small forward tolerance absorbs honest clock skew.
- **PoW freshness and difficulty.** The relay recomputes `epoch_hour = created_at - (created_at mod 3600)` from the header, accepts `epoch_hour` only in `{current_hour, current_hour - 1}` → else `400 stale-work`, and verifies the §4 preimage at the relay floor → else `400 low-work`. Two buckets, not one, so a submission that crosses an hour boundary in flight is not spuriously refused. Verified from the blob bytes and the wall clock alone; **no descriptor lookup**, so the relay still never resolves the recipient's pubky.
- `msg_id` not already present under this KID → else `409` (idempotent).
- Per-KID queue below its effective cap → else `503 queue-full`. **Reject, never evict *within* a KID.** Eviction inside a KID would let a flooder flush honest drops, which is worse than refusing the flooder.
- Per-IP token bucket → else `429`.
- `202` carries the signed receipt in §6.2.

#### 6.1 Global capacity: the KID namespace is unbounded, so per-KID caps alone do not bound the relay

A KID is 16 bytes of attacker-chosen hash output. An attacker mints as many as they like and, at PoW cost only, opens a queue under each. The relay **cannot** distinguish a junk KID from a real one — that is a direct consequence of §5.1 forbidding descriptor lookups, and it is the price of not handing the relay a KID→pubky oracle. So the relay's total footprint is `(number of KIDs) × (per-KID cap)`, and the first factor was unspecified. An unspecified global cap resolves at runtime into one of two failures: legitimate new KIDs starve behind junk, or a global eviction sweep flushes real queues and reintroduces exactly the eviction attack that reject-not-evict was written to prevent.

Specified:

- `GLOBAL_DROP_CAP` and `GLOBAL_KID_CAP` are configured values published in `GET /v1/info`. Reference deployment: `GLOBAL_DROP_CAP = 2_000_000` drops (≈2 GiB at 1 KiB) and `GLOBAL_KID_CAP = 250_000` KIDs.
- **Two-tier per-KID cap keyed on whether the KID has ever been read.** A KID with zero successful `POST /v1/fetch` in its lifetime is **cold** and capped at `COLD_KID_CAP = 4` drops. A KID that has completed at least one authenticated fetch — which requires decrypting a challenge, hence possession of the InboxKey secret — is **warm** and capped at `WARM_KID_CAP = 64` drops / 64 KiB, the original figure. A real recipient crosses cold→warm on their first poll. A junk KID never does, because nobody holds its secret. This caps the junk-namespace attack at 4 drops per minted KID instead of 64, a 16× reduction in the cheapest bulk-storage attack, and costs a real recipient nothing after first poll. **Nothing about warm/cold is exposed on any route** — it is not in `/v1/fetch` output, not in a header, not in `/v1/info` per-KID (only the two global constants are published). Exposing it per-KID would be a "has this inbox ever been polled" oracle, which is precisely the leak §Threat model spends §6.3 on.
- **At `GLOBAL_DROP_CAP` or `GLOBAL_KID_CAP`, eviction is global FIFO by `created_at` with per-KID fairness:** the relay evicts from the KID currently holding the most drops, oldest first, breaking ties by oldest `created_at`. Cold KIDs are drained before warm KIDs at equal depth. This never evicts a KID down to zero while any other KID holds more, so a flooder's 250,000 four-drop cold queues are consumed before a warm recipient's queue is touched. **Global eviction never applies inside a KID under its own cap** — the reject-not-evict rule in §Decision and §Threat model is a statement about intra-KID behaviour under a per-KID cap, and it is unchanged.
- The relay **MUST** publish `min_pow_floor`, `COLD_KID_CAP`, `WARM_KID_CAP`, `GLOBAL_DROP_CAP`, `GLOBAL_KID_CAP`, `max_blob_bytes`, the TTL, and the challenge rate-limit parameters in `GET /v1/info`, so a client can check a descriptor entry against the relay it actually names and a recipient can tell whether their chosen relay's caps match their policy.

**Waived, with the residual named:** the relay still cannot stop a funded attacker from occupying a large fraction of `GLOBAL_DROP_CAP` with cold junk KIDs, at a cost of one hourly PoW solution per 4 drops. Closing that would require either recipient identity resolution at the relay (rejected — §5.1) or an admission credential (rejected as a baseline — see *payment* in §Threat model). **Residual risk holder: the relay operator**, who absorbs it as storage cost and mitigates by raising `min_pow_floor` and lowering `COLD_KID_CAP`, both hot-reloadable and both published. It becomes unacceptable when sustained cold-KID occupancy exceeds 50% of `GLOBAL_DROP_CAP`, at which point the operator raises the floor and, if that fails, the correct answer is Phase D, not a bigger relay.

#### 6.2 The signed receipt binds the drop, not just the moment

The `202` payload signed with the relay's pinned Ed25519 key is:

```text
{ relay_pubky, inbox_kid, blob_hash: BLAKE3(blob), drop_id, accepted_at, expires_at }
```

The earlier payload was `{ drop_id, expires_at }`, which binds nothing a sender can prove anything with: it names no recipient, no content, and no submission, so it attests only "this relay signed some tuple." A recipient shown one cannot check it corresponds to a drop for them, and a relay that later denies accepting a specific blob is not contradicted by it. Including `inbox_kid` and `BLAKE3(blob)` makes the receipt a statement about *this blob for this queue*, which is the only form in which it functions as censorship evidence. `relay_pubky` prevents cross-relay presentation and lets a verifier check the signature against the key pinned in the descriptor's `drops` entry rather than one the relay supplies at verification time. `accepted_at` distinguishes replays of the same blob across hours.

The receipt remains **evidence of acceptance only**. It is not a delivery receipt, and no client may render it as one.

Explicitly **not** offered, and this is a security requirement rather than an omission: any endpoint or field revealing whether a drop was fetched, when it was fetched, that it was deleted, or whether a KID is warm or cold. A signed `202` proves the relay took it. Nothing proves the recipient read it.

#### 6.3 Challenge endpoint cost control

`POST /v1/challenge/{inbox_kid}` spends real asymmetric CPU per unauthenticated request — an X25519 ephemeral keygen, one DH, an HKDF, and an XChaCha20-Poly1305 seal (`Sb2::encrypt_params`, `sealed_blob_v2.rs:906-971`) — and §5.1 makes it deliberately open, so anyone can drive it. Three controls, all required, in this order:

1. **Per-IP token bucket**, distinct from and stricter than the submit bucket: `CHALLENGE_RATE = 10 requests / minute / IP`, burst 20. Exceeded → `429`. Parameters published in `GET /v1/info`.
2. **Per-KID challenge cache, `CHALLENGE_CACHE_TTL = 5 seconds`.** Within the window the same sealed blob is returned for the same `(inbox_kid, inbox_x25519_pub)` pair, so N concurrent requests cost one keygen. The KID-match check of §5.1 still runs on **every** request, cache hit or miss — the cache stores the sealed blob, never a trusted key. A 5-second nonce reuse window is acceptable because the nonce is single-use *per fetch* at the relay: a fetch consumes it, and a second fetch with the same nonce inside the window is idempotent against a queue the caller already proved they can read.
3. **Optional PoW floor on the challenge endpoint**, off in the reference deployment. If enabled, the required work is `min_pow_floor` over `"hypercolor-drop-challenge-pow/v1" || inbox_kid || u64_be(epoch_hour) || nonce`, its enabled/disabled state and difficulty are published in `GET /v1/info`, and clients read it from there — never from a hardcoded assumption. **This is the contract's stated position:** the rate limit and the cache are mandatory; the challenge PoW is a documented lever the operator arms under attack. It stays off by default because it taxes every legitimate poll, and polling is the recipient's own routine action, whereas the rate limit and cache cost a legitimate recipient nothing.

Deployment: Railway, per the workspace deployment-targets rule. Storage is a keyed queue with TTL; no user table, no accounts, no logs beyond the rate-limit window, and no retention of `inbox_x25519_pub` beyond the challenge cache entry.

### 7. Pending request rows render locally-attested data only

§Decision 5 says no attacker-controlled string reaches the request row. That is true of the *drop layer* — the sealed hint carries no body and adding one is forbidden. It is **not** automatically true of the *row*, and the gap is a real one this ADR must close rather than defer.

A pending row that renders only a 52-character z-base-32 pubky is unusable. Faced with that, the natural implementation resolves the stranger's profile — `GET /pub/pubky.app/profile.json` on their homeserver, or `GET /v0/user/{peer}/tags` on Nexus — and now two things are true that §Decision 5 was written to prevent. First, `name`, `bio`, `image`, and tag labels are **attacker-controlled bytes chosen after the attacker knew they were contacting this user**, rendered in the same row that asks "do you want to talk to this person" — a phishing surface with an unaccountable author, which is the exact objection that rules out a body field in the hint. Second, resolving on arrival tells the stranger's homeserver operator, and Nexus, that this specific user received and processed their contact attempt, and when — an on-arrival read is a delivery-and-processing confirmation channel that the drop layer refuses to provide, reintroduced one layer up.

Requirements of **this** ADR, not only of ADR 0003 item 4:

- A pending request row **MUST** render only: the peer pubky (truncated for display, full on demand), the arrival time, the relay that carried the drop, and locally-attested facts the local user themselves created — an existing contact row, an existing local tag, prior local history. Nothing fetched from the peer or from an indexer.
- Profile and tag resolution for a pending request **MUST** be triggered by the user opening that specific row, and **MUST NOT** run in a background sweep, on arrival, on list render, on scroll, or on prefetch. One row opened is one resolution.
- Any resolved profile field **MUST** be rendered as untrusted plain text: no markup, no links, no embedded images loaded from a peer-controlled URL (loading one is itself a beacon to the stranger's chosen host), length-clamped, with a visible self-asserted label such as "name they gave themselves." No verified affordance — no checkmark, no badge, no styling shared with an accepted contact.
- The row **MUST NOT** display anything derived from the drop other than the pubky, the arrival time, and the relay identity. `sender_receiver_path` is validated by `isValidReceiverPath` and used for routing; it is never displayed.

ADR 0003 item 4 keeps its own version of the open-on-demand rule for graph hints. This section is the stricter constraint and governs where they overlap.

## Threat model

### Spam and flooding

The queue is the target, and the queue is bounded. Four layers, honestly rated:

**Proof of work — a floor, not a wall.** Client-side, relay-verifiable, recipient-verifiable, needs no identity and no payment. At 20 bits a phone spends well under a second. That stops a script in a loop. It does not stop a botnet or a rented GPU: 20 bits is ~1M hashes, which is nothing at scale. Anyone claiming PoW solves messaging spam is selling something. Its actual job is to make the *trivially cheap* attack not free, and to give the recipient a knob (`min_pow_bits`) they can raise under attack without any coordination. The §4 hourly bucket adds one thing to that and no more: work cannot be stockpiled, so an attacker must keep paying rather than pay once. It does not raise the per-attempt cost.

**Per-KID caps — the real bound on *relay* state.** `WARM_KID_CAP` 64 drops per polled inbox, `COLD_KID_CAP` 4 for a KID nobody has ever fetched, reject-not-evict **within** a KID. The worst outcome of a successful flood is a request queue holding up to `WARM_KID_CAP` junk rows and honest strangers seeing `503 queue-full` — degraded, visible, self-healing on ack or TTL. Compare against the alternative failure mode where an attacker *displaces* real requests. Reject-not-evict is the difference between "annoying" and "an eviction attack." Global eviction (§6.1) is a separate mechanism that applies across KIDs at the relay's total capacity and never inside a KID under its own cap.

**This bounds the relay, not the device.** Acking a processed drop frees the slot, so a flooder cycles and the *cumulative* number of distinct pubkys that pass through is unbounded even though instantaneous depth is not. Local bounds are specified separately in §5.2 and are load-bearing, not hygiene.

**Introduction tickets — the escape hatch under attack.** An already-accepted contact mints a ticket: a short signed statement naming the introduced pubky and an expiry, carried inside the sealed hint. A ticketed drop bypasses PoW and is rate-limited per issuer. A recipient under attack sets `require_ticket: true` and their inbox becomes warm-intro-only without going fully closed. This needs no new Pubky primitive — the issuer already has an Encrypted Link to the recipient, and the ticket is verified against the recipient's own accepted-contact table.

**Payment (Paykit) — rejected as the baseline, kept as a tier.** Evaluated seriously because this app has a payments layer, and it does not hold up:

- Offline verification is impossible for a stranger. `verifyBolt11Preimage` (`src/services/payments/proofVerify.ts`) checks a preimage against a `payment_hash` **the recipient already possesses from an invoice they issued**. A stranger has no such invoice. A static endpoint (`/pub/paykit/v0/{receiver}/endpoints/`) yields a payment that is not bound to this drop and cannot be checked without asking the recipient's own node — an online oracle that correlates payment to contact attempt.
- Even if bound, "pay to say hello" excludes users without funds and links a payment record to a contact attempt.

So: payment is coherent only as an **optional priority tier** a recipient may enable for high-volume accounts, and only once a drop-bound payment proof exists. That proof is a new primitive and is not on this ADR's critical path.

**What we are not claiming.** None of this stops a determined, funded attacker from keeping 64 junk rows in a specific user's queue. The design goal is that this is *bounded, visible, and reversible* — cap it, raise the bar, require tickets, or close the inbox and fall back to manual add. Every one of those is one toggle, no migration.

### Storage exhaustion and DoS

Who pays what. **Relay-state bounds and local-state bounds are separate mechanisms and must not be conflated** — the previous version of this table did conflate them and was wrong about the second:

| Cost | Bearer | Bounded by | Bound |
|---|---|---|---|
| Sealed drop, one KID | relay operator | per-KID cap, TTL | 1 KiB × `COLD_KID_CAP` 4 (never fetched) or `WARM_KID_CAP` 64, 7-day TTL, reject-not-evict inside the KID |
| Sealed drops, all KIDs | relay operator | global cap (§6.1) | `GLOBAL_DROP_CAP` / `GLOBAL_KID_CAP`, global FIFO with per-KID fairness, cold drained before warm |
| Challenge CPU | relay operator | §6.3 | per-IP token bucket + 5s per-KID cache + optional PoW lever |
| Message payload | **the sender**, on the sender's own tenant | sender's homeserver | sender's `user_quota_bytes`, sender homeserver's `PathLimit` |
| Descriptor | recipient's own tenant | — | one object, a few hundred bytes |
| Pending request rows | recipient's device | §5.2 cap + TTL, **not** the relay cap | `PENDING_REQUEST_CAP` 256 LRU, `PENDING_REQUEST_TTL` 30 days unviewed, declined rows 90 days |
| Hint-sourced `links` rows and the repeat probes they cause | recipient's device **and** the recipient's bandwidth/IP exposure | §5.2 prune rule, **not** the relay cap | pruned from `collectInboxCandidates` after `INBOX_HINT_PROBE_LIMIT` 3 failed syncs |

The relay cap bounds *instantaneous* relay occupancy for one KID. It does not bound cumulative local state, because acking a drop frees the slot and lets the flooder cycle — see §5.2 for the full mechanism and the three bounds that do the local work.

The important line is the message-payload line. Flooding *bodies* costs an attacker their own homeserver quota and trips their own operator's rate limits — an existing enforcement point we inherit for free by keeping payloads on the sender's tenant. An attacker who wants to flood 10,000 users with real message bodies must store 10,000 payloads under their own quota. That is the single best anti-abuse property in the design, and it is a direct consequence of not building a mailbox.

Relay availability is a real DoS surface. Losing the relay costs *new first contact only*. Established conversations are untouched; they never route through it.

### Metadata leakage

What the relay learns, precisely:

| Learns | Notes |
|---|---|
| An `inbox_kid` | Not given the recipient's pubky, and §5.1 forbids the relay from resolving one. But the KID→pubky map is **public** in world-readable descriptors, so a relay that crawls homeservers recovers it. **Treat recipient identity as exposed to the relay.** |
| An `inbox_x25519_pub`, per challenge request | Presented by the caller and verified against the KID (§5.1). It is already world-readable in the descriptor, so this adds nothing the relay could not fetch — but it does hand the relay the pre-image of the KID it is already holding, which is why §5.1 forbids retaining it past the challenge cache entry. |
| That drops exist for that KID, when, how many, and their size | Size is constant by design, so volume and timing only. |
| Whether a KID has ever been successfully fetched (warm vs cold) | Yes, internally — §6.1 needs it for the two-tier cap. **Never exposed on any route**, because per-KID it is a "has this inbox ever been polled" oracle. |
| Roughly when a recipient polls | Yes, from its own fetch traffic — the relay is the counterparty to the poll, so this is unavoidable for the relay itself. What §5.3 and the randomized headroom defend against is **third parties** recovering it through the `503→202` edge. A relay is trusted with its own request log or it is not used. |
| Submitter IP, fetcher IP | The strongest deanonymiser here. We do not defeat a network observer. Tor/VPN is the user's mitigation, and the relay must not retain IPs beyond the rate-limit window. |
| Sender pubky | **No.** Sealed, and the header carries only a throwaway key. |
| Message content | **No.** It never enters the drop layer. |
| Social graph | Only "N strangers contacted this KID." Not who. |

Against Signal's sealed sender: comparable on sender identity (their server does not learn the sender for sealed-sender messages; ours does not either), **worse** on recipient identity (their account↔KID equivalent is not world-published; ours is, by construction — a stranger must be able to find your address), **better** on enrolment (no phone number, no account, no server-side identity at all).

Against the current closed model: the closed model wins outright on metadata. There is no third party, and a sender's outbound attempts are invisible even to their own homeserver operator, because the paths are DH-derived hashes over opaque ciphertext. **Opening the inbox introduces a third party that learns your inbox is being contacted.** That is the price, it is real, and the mitigation is that the price is opt-in per user and the fallback needs no relay.

Against a naive SB2 drop (profile ignored): far better. The default SB2 header names both parties in cleartext, so a naive relay would hold a plaintext social graph of who messages whom. The profile in §2 is not a nicety.

### The 503↔202 transition is a recipient-activity oracle

This was previously understated. The sender-feedback table claimed `503 queue-full` leaks "volume only, not identity or presence." Volume is right; presence is wrong.

The attack needs nothing privileged. `inbox_kid` is public in a world-readable descriptor, and `POST /v1/drop` is open by design, so **anyone can probe any inbox's fullness at PoW cost.** An attacker fills a target's queue to `WARM_KID_CAP` and then submits a probe drop on a schedule. While the queue is full every probe returns `503`. The instant the recipient polls and acks, a slot frees and the next probe returns `202`. The transition timestamp is a measurement of *when that specific user opened their app and synced* — and repeated over days it is a sleep schedule, a timezone, and a work pattern, for a user who has never accepted, replied to, or even seen the attacker. The recipient cannot detect the probing, and no amount of "we expose no per-drop fetch state" helps, because the signal is not per-drop state; it is the aggregate queue depth, which the accept rule must expose in order to say `503` at all.

The mitigations reduce resolution; they do not remove the channel:

- **Batched, randomized-delay acks (§5.3).** Acks fire 0–900 s after the sync that processed them, jittered per relay, so the observed `503→202` edge is uniformly smeared across a 15-minute window rather than marking the sync instant. This is the main defence and it is cheap: nothing user-visible waits on an ack.
- **Randomized relay headroom near the cap.** The relay does not switch to `503` at exactly `WARM_KID_CAP`. It draws a per-KID reserve `r` uniformly from `[0, 8]`, re-drawn on each transition into the near-full band, and returns `503` at `cap - r`. The boundary an attacker is probing therefore moves for reasons unrelated to recipient activity, so a single `503→202` edge no longer implies a poll happened.
- **Batching means one ack frees many slots at once**, so the edge carries no information about how many drops were read.

**Residual, stated plainly and accepted.** A patient attacker who probes continuously for days still recovers a coarse activity distribution — roughly "this user syncs during these hours" at ~15-minute resolution — for any user whose inbox is open and whose queue the attacker is willing to keep full at hourly PoW cost. Removing the last of it would require the relay to stop signalling fullness at all, which means silently discarding drops at the cap; that trades a coarse presence leak for undetectable message loss, and is a worse trade for the user. **Residual risk holder: the recipient**, disclosed in the open-inbox settings copy as "people can tell your inbox is being contacted, and a determined observer can infer roughly when you check it." It becomes unacceptable if the resolution is ever better than the ack window — which is why the ack delay is normative and not a tuning parameter, and why any future change that acks promptly for responsiveness must be treated as a security regression, not a UX improvement.

### Rotation bounds exposure only if retired secrets are actually destroyed

The unlinkability section states that rotation buys revocation and epoch-bounded exposure. That is conditional in a way the earlier draft did not honour, and its own §Required primitives contradicted it.

The condition: **a retired InboxKey secret must be destroyed when its TTL expires.** Until then it must be retained, because §5 polls retired KIDs still inside TTL and needs the secret to decrypt drops addressed to them. So the retention window is exactly the retired-epoch TTL, and "epoch-bounded exposure" means bounded by that window and nothing else. The earlier draft simultaneously required "inclusion of the InboxKey alias in `/pub/hypercolor.app/v1/backup/latest`" with no pruning rule, which means a backup accumulates every epoch's key forever, and a single backup compromise then decrypts every drop the user ever received, across all epochs. That is not epoch-bounded exposure; it is a permanent archive of who tried to contact you, and it converts rotation from a mitigation into bookkeeping.

There is no forward secrecy to fall back on: the key schedule is sender-ephemeral × recipient-**static** (`Sb2::encrypt_params` `sealed_blob_v2.rs:906-971` — one `x25519` against `recipient_inbox_pk`, no ratchet), so a retained secret decrypts every retained blob for its epoch.

Required, and these are release-blocking:

- **Retired InboxKey secrets are destroyed at retired-epoch TTL**, zeroized in the native/alias layer, and the descriptor's `retired` entry is removed in the same operation. After that point drops to that KID are undecryptable by anyone, including the user, which is the intended end state.
- **Backups carry the live epoch alias only.** A backup written at epoch N contains epoch N's alias and no earlier one. Restoring a backup older than the current epoch yields a key that decrypts nothing current, which is correct: the user's inbox address rotated and strangers now seal to the new one.
- **Rotation is not a compromise recovery on its own.** Compromise of the *current* InboxKey secret is not limited to reading. The holder can decrypt a challenge and therefore call `POST /v1/fetch` and `DELETE /v1/drop` — they can read the victim's pending intros **and delete them before the victim polls**. That is active, silent censorship of cold inbound with the same credential that reads it, and it is indistinguishable from an empty inbox. There is no detection for it in this design; the response is rotate the epoch (which invalidates the stolen secret for all future drops) and fall back to the closed path for anything urgent. Rotation must therefore be a user-reachable action, not only an automatic schedule.

**Custody decision for Phase A, made here rather than left open.** Phase A ships **native-alias custody** (`mintInboxKey(sessionAlias)` / `inboxKeyDecrypt(alias, blob)`), the preferred option in §Required primitives 4. This is not a preference; the alternative is a confirmed regression. `x25519GenerateKeypair` returns `{ publicKey, secretKey }` as hex strings **into the caller** (`paykit-wasm/src/sb2.rs:16-23` → `x25519_generate_keypair_hex`), which on web means the InboxKey secret is a JS string, contradicting `src/types/link.ts`'s standing rule that "the Noise secret NEVER enters JS" and `SECURITY.md`'s "XSS is the kill shot."

The web exception, if the browser build genuinely cannot hold the secret outside JS-visible memory: it ships **only** with a `SECURITY.md` section stating that the InboxKey secret is JS-reachable on web, that XSS therefore yields not just message compromise but the ability to fetch and delete the user's pending intros, and that mobile holds the same key behind an alias. That section is a **named release gate** — the web open-inbox toggle does not ship until it exists and has been reviewed, and it is listed as such in the Phase A proof. It is an explicit product decision with a named residual holder (**the web user**, disclosed in the toggle copy), not a default arrived at by shipping the easier code path.

### A pending stranger's group PAM is applied before accept

Investigated because the accept gate's guarantee is stated in terms of DMs and the group domain has its own inbound path. **The specific escalation feared — a stranger's group PAM permanently satisfying the DM accept gate — does not exist.** But a real adjacent hole does, and this ADR is what makes it reachable.

What is closed, with evidence from `BitcoinErrorLog/hypercolor` pin `a373cd1`:

- `routeHeldGroupInbound` (`src/services/link/LinkService.ts:1403`) is reached from `persistInboundWithoutRouting` (`:1381`) while a request is pending, and applies group PAMs via `applyGroupInbound`.
- `applyGroupInbound` (`src/services/group/applyGroupInbound.ts`) touches **only** group tables. Its full `StorageService` call set is `hasGroupEvent`, `markGroupEventSeen`, `touchGroupChannel`, `getGroupChannel`, `getGroupMember`, `upsertGroupMember`, `updateGroupChannelName`, `bumpGroupMembershipEpoch`, `insertInboundPrivateCreate`, `getGroupMessage`, `findGroupMessageByAuthorEvent`, `saveGroupDeferred`, `listGroupDeferredForTarget`, `deleteGroupDeferred`, `applyGroupMessageEdit`, `tombstoneGroupMessage`, `saveGroupMessage`. It never writes `link_messages`: `saveGroupMessage` (`StorageService.ts:1388`) calls `insertGroupMessage`, and `insertInboundPrivateCreate` (`:1210`) writes `group_channels` and `group_members`.
- `hasPriorRoutedConversation` is computed from `countLinkMessagesForPeer` (`:228`), which is `SELECT COUNT(*) ... FROM link_messages`. The only production writers of that table are `insertLinkMessage`'s three callers — `applyAttachmentInbound.ts:210`, `LinkService.ts:1652` (inside `routeUnprocessedStreamItems`, the post-accept path), and `liveProofBackup.ts:125` (a proof harness) — none of which is in `applyGroupInbound`'s call graph, and none of which `routeHeldGroupInbound` invokes.

So a stranger's group PAM cannot manufacture the auto-accept bit. **Assertion required in Phase B** so it stays that way: a test that drives a group create plus a group message from a peer with a pending request and asserts `countLinkMessagesForPeer(owner, peer) === 0` and `classifyInboundPeer` still returns `request`. This must be an assertion on the table, not on `applyGroupInbound`'s current call list, because the invariant is "nothing pre-accept writes `link_messages`," and a future group feature that legitimately wants a DM row would otherwise silently open the gate.

What is **open**, and is a finding of this ADR:

`authorizeMembership` (`applyGroupInbound.ts:124-162`) accepts a `group.membership` PAM with `op: 'create'` from **any** sender, with no accepted-contact requirement, provided only that the sender's pubky matches the founder field parsed out of the channel id they themselves chose (`parsePrivateChannelId`, `src/types/group.ts:156`) and no local channel by that id exists. `applyMembership` (`:171-214`) then builds a roster that explicitly includes the recipient — `roster.add(senderPubky); roster.add(ownerPubky)` (`:183-184`) — and calls `insertInboundPrivateCreate`, writing a `group_channels` row with an **attacker-chosen `name`** and a `group_members` row marking the recipient `status: 'active'`. Having made themselves an active admin of that channel, the stranger passes `authorizeInbound`'s member check (`:111-116`) for subsequent `group.message` PAMs, each of which `persistAdmitted` (`:443`) writes to `group_messages` with an attacker-chosen body, followed by `touchGroupChannel` and `notifyGroupEvent`. `StorageService.listGroupChannels` (`:1275`) filters on nothing but `owner_pubky`, and `GroupService.listChannels` (`src/services/group/GroupService.ts:57`) feeds it straight to `ChannelsScreen.tsx:46`.

Net: **a stranger whose DM request is still pending can put a group conversation with an attacker-chosen title and attacker-chosen message bodies into the recipient's channel list, and fire a notification.** The DM request queue holds the line; the group list has no equivalent gate.

This is latent today only because a stranger cannot be probed at all — the enumeration defect this ADR exists to fix is what currently protects the group list. **Opening the inbox converts this from unreachable to routinely reachable**, so it is this ADR's problem and not a pre-existing issue to hand off.

Required for Phase B, in `BitcoinErrorLog/hypercolor`:

- `routeHeldGroupInbound` **MUST NOT** apply `group.membership` with `op: 'create'` from a peer whose `message_requests` row is `pending` or absent. Such an item stays unprocessed — the mechanism `routeHeldGroupInbound` already has, since it defers chat, attachment, and payment items the same way — and is applied on accept, or discarded by the §5.2 teardown on decline or age-out.
- The same restriction applies to `op: 'add'` naming the recipient as subject. A pending stranger may not add the recipient to anything.
- Membership and message PAMs for a channel the recipient is **already** an active member of continue to apply while a request is pending. That is the existing and correct behaviour: it is why `routeHeldGroupInbound` exists, and it does not admit anything new.
- **Proof (Phase B):** a peer with a pending request sends `group.membership op:create` for a channel id bound to their own pubky, then a `group.message`. `listGroupChannels` returns no new row, `group_members` contains no row for the recipient, and no notification fires. Accept the request; the same PAMs then apply and the channel appears.

### Unlinkability

- **Many senders → one recipient:** linkable. They share the KID. That *is* the addressing; there is no way around it short of per-sender addresses, which cannot exist for strangers.
- **One sender → many recipients:** unlinkable at the crypto layer — fresh ephemeral key, fresh `context_id`, fresh nonce, different KID, constant size. Linkable at the network layer by IP and timing. We do not fix that.
- **KID → pubky:** public. Rotation republishes to the same public descriptor, so rotation buys revocation and epoch-bounded exposure, **not** unlinkability. Claiming otherwise would be false.

### Censorship resistance

A relay can silently drop. Mitigations and their limits:

- **Multi-relay.** The descriptor lists N; the sender fans out to all; the recipient polls all and dedupes by `msg_id`. Censorship then requires all listed relays to collude.
- **Signed acceptance receipts.** The sender holds a relay-signed `202`. Evidence that the relay took it.
- **Detection is weak, and we should say so.** The recipient cannot distinguish "no one messaged me" from "everything was dropped." Senders hold receipts; recipients hold nothing. Resolving a suspected censoring relay is out-of-band. We deliberately do not build a heartbeat, because a heartbeat is an online-status oracle.
- **The real answer is the fallback.** Manual add and follows import need no relay at all. A censoring relay costs cold-open reachability, not the messenger.

### Replay and ordering

- Relay: `msg_id` idempotency, `created_at`/`expires_at` window, per-KID cap. A replayed blob is byte-identical and is dropped.
- Recipient: the hint is idempotent by construction — "go poll pubky X" twice is the same instruction. The PAM stream dedupes real messages by `(owner_pubky, sender_pubky, kind, event_id)`.
- Ordering: not applicable. The drop layer has no order because it has no content. Removing an ordering problem is the second-largest structural win of the pointer design, after removing forward-secrecy exposure of content.
- Cross-epoch: drops to a `retired` KID are accepted from the relay but discarded locally after TTL.

### Sender failure signal

Today's silent failure is the defect. What the sender is entitled to:

| Signal | Source | Leaks? |
|---|---|---|
| `inbox closed` | 404 on a **world-readable** descriptor | No — anyone can fetch it |
| `queued` | relay `202`, signed | No — the sender's own submission |
| `rejected: work too low` / `too large` / `duplicate` | `400 low-work` / `413` / `409` | No |
| `rejected: work expired` / `clock skew` | `400 stale-work` | No — a statement about the sender's own clock |
| `rejected: inbox full` | `503 queue-full` | **Yes: queue volume, and a weak recipient-presence signal.** Anyone can probe fullness because the KID is public and submit is open; the `503→202` transition correlates with the recipient having polled. Reduced by randomized-delay batched acks (§5.3) and randomized relay headroom, not eliminated. See §Threat model → *recipient-activity oracle* for the accepted residual and who holds it. |
| `rate limited` | `429` | No |
| `relay unreachable` | transport | No |

And what the sender never gets: delivered, read, fetched, acked, seen, online. `DELETE` is invisible to the sender. **No endpoint exposes per-drop fetch state.** That boundary is what separates an honest failure signal from a presence oracle, and it is a Phase C proof.

UI consequence: the outbound row for a cold open reads `Request sent` — not a delivered checkmark. If the recipient never accepts, it stays `Request sent` forever, which is the truth.

## Rejected alternatives

### Sender-side publication + graph discovery (Nexus / pkarr)

The sender writes a sealed blob to a public path on their own homeserver; the recipient finds it by asking an indexer.

**Pros:** No new service. Uses the tenant model as designed. The payload already lives there.

**Cons, in order of severity:**

1. **Nexus cannot see it.** `Resource` (`pubky-app-specs/src/uri/resource.rs`) has no Hypercolor variant and `Unknown` is `#[default]`; the watcher matches known `PubkyAppObject` pairs and otherwise logs `"Event type not handled"` (`pubky-nexus/nexus-watcher/src/events/mod.rs`). A drop PUT is dropped. Making it visible means adding a DM-shaped `Resource` variant to shared specs — teaching the public social indexer to model direct messages, which ADR 0002 identifies as exactly how you deanonymise a messenger.
2. **It re-expands Nexus trust that was deliberately reduced.** Recent work stopped writing `isFollower`/`isMutual` from Nexus and re-confirms follows against the homeserver. Making inbox *delivery* depend on the indexer would make a third party able to withhold messages, not merely slow discovery. There is no justification available for that trade, so the design does not attempt one.
3. **It publishes the sender's outbound contact graph.** A world-readable per-sender drop directory whose entries carry a cleartext `inbox_kid` (a required SB2 header field) lets anyone list who a user is trying to reach. The current DH-derived paths leak nothing of the kind. This is a regression that cannot be fixed without changing SB2's required fields in `pubky-crypto`.

**Why not chosen:** blocked on a specs change we should not want, and leaks the sender's social graph.

### Recipient-advertised drop point via pkarr

The recipient publishes a drop endpoint in their pkarr record.

**Pros:** No homeserver read for discovery; DHT-distributed; naturally the recipient's own choice of operator.

**Cons:**

1. **Hypercolor cannot write pkarr.** The app holds a scoped homeserver session, not the identity key. `publish_homeserver` (`pubky-sdk/src/actors/pkdns.rs`) needs the keypair, which lives in Ring, and `signinWithSecret` is e2e-only (`SECURITY.md`). Nothing in this tree publishes a pkarr record — it only resolves them (`src/services/homeserverOrigin.ts`). Advertising in pkarr requires a **new Ring capability**: "publish an app record in my packet." That does not exist.
2. **It buys nothing over the homeserver path.** A descriptor at `/pub/hypercolor.app/v1/inbox/v1.json` is world-readable over unauthenticated GET, fits the grant we already hold, updates instantly, and has no size ceiling. pkarr packets are small and DHT-republished, so rotation is slower.
3. **Same chokepoint.** Whoever runs the advertised endpoint is the same trusted party as the relay. Moving the pointer to pkarr does not decentralise the endpoint.

**Why not chosen:** blocked on a Ring capability, and strictly worse than a homeserver descriptor even if unblocked. Reconsider only if descriptor availability (sender homeserver ban) becomes the binding constraint.

### UKD/SB2 blob relay carrying the message body

The obvious generalisation of the handoff: seal the actual first message and let the relay hold it.

**Pros:** One round trip. The recipient sees the first message immediately, even if the sender's homeserver is later banned.

**Cons:**

1. **No forward secrecy for content.** Sender-ephemeral × recipient-static. Compromise of the InboxKey secret decrypts every retained body for that epoch. With pointers, the same compromise leaks only *who tried to contact you*.
2. **Unauthenticated text in the UI.** The drop is authenticated by a throwaway key. Rendering that text in a request row is a phishing surface with no accountability.
3. **Storage economics invert.** 64 KiB blobs at the relay instead of 1 KiB, and the payload cost moves off the sender's own quota, discarding the best anti-abuse property we have.
4. **Two transports must agree on ordering and dedupe.** The PAM stream already owns that. Duplicating it invites divergence bugs at exactly the boundary that handles hostile input.

**Why not chosen:** it turns a discovery problem into a message-storage problem and pays for it in crypto, abuse surface, and code paths.

### Publish a write-only session cookie for the recipient's own inbox prefix

The recipient signs in with `/pub/hypercolor.app/v1/inbox/:w` and publishes the session secret so strangers can PUT directly.

**Pros:** No relay at all. No new service, no new operator, no new trust. Genuinely the most elegant shape.

**Cons, and the first one is fatal:**

1. **`Action::Write` is PUT/POST/DELETE** (`pubky-common/src/capabilities.rs` module docs and `Action::Write`; authz checks only `contains(&Action::Write)`). A public write grant over a prefix is a public **delete** grant over that prefix. Any stranger wipes the inbox. There is no append-only action, and per-sender subpaths do not help because scope matching is `path.starts_with(&cap.scope)`.
2. **The recipient's own quota becomes the attacker's budget** (`user_quota_layer.rs`), with no per-sender accounting.
3. Session cookies are `Duration::days(365)` and only the holder can revoke (`SessionRepository` has `create`/`get_by_secret`/`delete`-by-secret). Publishing one is publishing a year-long bearer credential.

**Why not chosen:** blocked on a missing capability action. **This is the design we actually want**, which is why Phase D proposes `Action::Append` upstream. See required primitives.

### `pubky-core` `http-relay` as the drop point

**Cons:** it implements the httprelay.io *link* pattern — `get_handler` blocks up to `request_timeout` waiting for a matching POST and nothing is retained (`pubky-core/http-relay/src/http_relay.rs`). Both parties must be online simultaneously.

**Why not chosen:** it is a rendezvous, not an inbox. Correct for the auth flow it was built for; structurally unable to hold a message request.

### Auto-accept anything

**Why not chosen:** the accept gate is the spam defense. Upstream explicitly narrowed auto-accept to `hasPriorRoutedConversation` and documents that follow / mutual / manual add "MUST NOT be re-introduced as accept conditions." A PoW solution, a paid invoice, a public tag, and a follow are all things an attacker can manufacture or a colluding cluster can fake. Opening the inbox is only safe because the gate stays shut.

## Required new primitives

Nothing below is optional hand-waving; each is a named file in a named repo.

### 1. Drop relay service — new repo `BitcoinErrorLog/hypercolor-drop`

| File | Contents |
|---|---|
| `src/main.rs` | axum server, config, Railway entrypoint |
| `src/routes/drop.rs` | `POST /v1/drop/{inbox_kid}` with the accept rules in §6, including the PoW hour-window check |
| `src/routes/fetch.rs` | `POST /v1/challenge` with the §5.1 KID-match check, `POST /v1/fetch`, `DELETE /v1/drop/{kid}` (batch ack), `GET /v1/info` publishing every cap in §6.1 and the §6.3 rate-limit parameters |
| `src/store.rs` | per-KID capped queue with the warm/cold two-tier cap, global FIFO eviction with per-KID fairness (§6.1), TTL sweeper, `msg_id` idempotency index, randomized per-KID near-cap reserve |
| `src/pow.rs` | thin wrapper over the shared PoW crate, including `epoch_hour` derivation and two-bucket acceptance |
| `src/receipt.rs` | relay Ed25519 signing of the §6.2 receipt payload |
| `src/challenge.rs` | per-IP token bucket, 5-second per-KID sealed-blob cache, optional challenge PoW lever (§6.3) |

Depends on `pubky-crypto` (`sealed_blob_v2` for the challenge, shared PoW). No user table, no accounts. **The KID-match check in `src/routes/fetch.rs` is the single most security-critical line in the service** — omitting it is the total-inbox-takeover in §5.1 — and it carries the Phase B mismatch-rejection proof.

### 2. Shared proof-of-work — `BitcoinErrorLog/pubky-crypto`, new `src/drop_pow.rs`

One canonical implementation over BLAKE3 with domain `"hypercolor-drop-pow/v1"`, exported from `src/lib.rs`. Web, iOS, Android, and the relay must agree bit-for-bit; four independent implementations would diverge and the divergence would present as unexplained rejected drops. The preimage includes `u64_be(epoch_hour)` per §4, and the crate's doc comment **must** state that `epoch_hour` is derived from a Unix-**seconds** `created_at` — this is the third schema the seconds/milliseconds divergence in F-10 can enter through, and the only one whose failure mode is a silent difficulty mismatch rather than a rejected timestamp.

Bindings, both thin:

- `BitcoinErrorLog/paykit-rs-official` — new `paykit-wasm/src/pow.rs`, `dropPowSolve` / `dropPowVerify`, registered in `paykit-wasm/src/lib.rs`.
- `BitcoinErrorLog/pubky-noise` — `src/ffi/config.rs`, UniFFI `drop_pow_solve` / `drop_pow_verify`, regenerating `generated-swift/` and `generated-kotlin/`.

### 3. Propagate the `paykit-wasm` pin — not a new build

Downgraded from "build new exports." Verified against the official checkout `BitcoinErrorLog/paykit-rs-official` at HEAD `a2999bf`: `paykit-wasm/Cargo.toml` is `0.1.0-rc47`, and the built `paykit-wasm/pkg/paykit_wasm.d.ts` already exports `computeInboxKid`, `sb2Encrypt`, `sb2Sign`, `sb2Decrypt`, `sb2VerifySignature`, `x25519GenerateKeypair`, `generateNoiseSecretKey`, and `noisePublicKeyFromSecret`. **Nothing needs to be written in `paykit-wasm` for the SB2 send path.**

Only *this worktree's* copy is stale: `vendor/paykit-wasm/` is `0.1.0-rc44` (`PROVENANCE.md`) and its `paykit_wasm.d.ts` has no `computeInboxKid`, `sb2Encrypt`, or `sb2Sign`. The task is therefore mechanical: copy `paykit-wasm/pkg` from the rc47 HEAD into `vendor/paykit-wasm/`, update `PROVENANCE.md` (commit, upstream pin, version, export list), and re-run `scripts/check-wire-drift.sh`. Effort is a pin bump, not a binding project.

Two notes so this is not re-discovered later. `verifyAppCert` is **not** exported at rc47 — `verify_app_cert` exists in `pubky-crypto::ukd` and is re-exported from that crate's `lib.rs`, but has no wasm binding. It is not needed here: the profile in §2 sets `cert_id: absent`, so no AppCert is verified on the drop path. And the vendored rc44 already exports `sb2Decrypt`, so Phase A's descriptor work and the challenge-decrypt path are unblocked on the current pin; only the send path needs rc47.

### 3a. The ephemeral Ed25519 keypair is already mintable — one clarity wrapper, not a new primitive

An audit of this ADR reported that "the wasm surface cannot mint the ephemeral Ed25519 key the profile requires" and that `paykit-wasm` exports no Ed25519 keypair generation. **Checked directly; that is not correct**, and the corrected position matters because it moves a claimed Phase B blocker off the critical path.

The pair already exported — in the **stale rc44 vendored build**, not merely upstream — is sufficient:

- `generateNoiseSecretKey(): Uint8Array` returns a random 32-byte **Ed25519 secret**, independent of the Pubky identity key (`vendor/paykit-wasm/paykit_wasm.d.ts:346-354`).
- `noisePublicKeyFromSecret(secret): string` returns the matching Ed25519 **public key in z-base-32** — it is literally `pubky::Keypair::from_secret(&bytes).public_key().z32()` (`paykit-wasm/src/keys.rs:27-30`).
- `sb2Sign` takes the sender's Ed25519 secret as 32 raw bytes, and `sb2Encrypt`'s `senderPeerid` / `recipientPeerid` accept z-base-32 (`parse_public_key_z32_or_hex`, `keys.rs:79-91`).

So the profile's per-drop ephemeral key is `generateNoiseSecretKey()` plus `noisePublicKeyFromSecret()`, with the secret discarded after `sb2Sign`. `pubky-crypto::ukd::generate_app_keypair` (`ukd.rs:497`) is unbound to wasm, and stays unbound — it is not needed. Nothing blocks Phase B here.

What is genuinely required is a **naming and misuse guard, sized as a small task rather than a primitive.** The existing export is documented as a *receiver-scoped* Noise key that the caller should "store as a secret… required to restore Encrypted Links and to derive private message paths." Reaching for that function to mint a throwaway is an invitation to two specific bugs, both of which destroy the sealed-sender property silently: persisting the ephemeral secret alongside real receiver keys, or passing the user's **actual** receiver Noise public key as `sender_peerid`, which would stamp a durable, linkable sender identity into the cleartext header of every drop — exactly what §2 exists to prevent, with no test failure to reveal it.

- `BitcoinErrorLog/paykit-rs-official` — add `ephemeralEd25519Keypair()` to `paykit-wasm/src/sb2.rs`, returning `{ publicKeyZ32, secretKey }` as a thin wrapper over the same `pubky::Keypair::random()` path, documented as single-use and never persisted. Registered in `paykit-wasm/src/lib.rs`.
- `BitcoinErrorLog/pubky-noise` — the same wrapper in `src/ffi/config.rs` for parity, regenerating `generated-swift/` and `generated-kotlin/`.
- `BitcoinErrorLog/hypercolor` — `DropService.ts` must obtain the ephemeral key **only** from that wrapper and must never read `LinkReceiver`'s receiver key material on the send path. Phase B proof: a test asserting that two consecutive drops to the same recipient carry different `sender_peerid` values, and that neither equals the sender's receiver Noise public key.

If the wrapper is not ready, Phase B may ship using `generateNoiseSecretKey` + `noisePublicKeyFromSecret` directly, provided the two-drops-differ and not-the-receiver-key assertions are in place. The wrapper reduces the chance of the bug; the assertions are what actually prevent it, and they are mandatory either way.

### 3b. `MAX_CBOR_DEPTH` is declared and never enforced — `BitcoinErrorLog/pubky-crypto`

`sealed_blob_v2.rs:32` declares `pub const MAX_CBOR_DEPTH: usize = 2;` with the comment "Maximum CBOR nesting depth." Nothing reads it. `decode_header` (`:549`) enforces `MAX_CBOR_KEYS` and every field's exact length, but unknown keys fall through to `skip_value` (`:498-545`), which recurses into arrays (`:519-524`) and maps (`:525-532`) with **no depth parameter and no depth check**. A header carrying an unknown integer key whose value is deeply nested arrays recurses once per level.

The blast radius is small and worth stating precisely rather than overselling: `MAX_HEADER_LEN` is 2048 bytes and is checked before decode (`:882`), and `POST /v1/drop` caps the whole blob at 1024 bytes, so the attainable depth is bounded by roughly the byte budget — about two thousand frames of a small recursive function. That is unlikely to overflow a relay's main-thread stack and it costs an attacker a PoW solution per attempt. It is nonetheless an unbounded-recursion path on attacker-controlled bytes in a crate four surfaces link against, at least one of which (wasm, with a 1 MiB default stack) has far less headroom than the relay, and the constant's presence documents an intent the code does not implement — so a future reader reasonably assumes the check exists.

Fix, either way, no waiver: thread a depth counter through `skip_value` and return `CryptoError::Decryption` past `MAX_CBOR_DEPTH`, **or** delete the constant so no reader is misled. Prefer enforcing. Add a test that a header with an unknown key holding nesting deeper than `MAX_CBOR_DEPTH` is rejected by `Sb2Header::decode` rather than recursed into, and a test that a header with an unknown key holding a *flat* value still decodes, so forward compatibility is not silently dropped.

### 4. InboxKey custody — `BitcoinErrorLog/hypercolor`

The InboxKey X25519 secret is a **new secret class**. It must be held the way the receiver Noise secret is held: minted natively and referenced by an opaque alias, never materialised in JS (`src/types/link.ts` `LinkReceiver`: "the Noise secret NEVER enters JS").

`x25519GenerateKeypair` returns `{ publicKey, secretKey }` as hex **into the caller** (`paykit-wasm/src/sb2.rs:16-23`) — on web that means into JS memory, which is a regression against the receiver-alias pattern and against `SECURITY.md`. **Phase A ships the alias form**; the decision is made in §Threat model → *Rotation bounds exposure*, not left open:

- Mint and store the InboxKey behind an alias in the native/wasm layer, adding `mintInboxKey(sessionAlias)` and `inboxKeyDecrypt(alias, blob)` to `paykit-wasm/src/sb2.rs` and the `pubky-noise` FFI. **Chosen.**
- The web fallback, only if the browser build cannot hold the secret outside JS-visible memory, ships behind the `SECURITY.md` release gate specified in that section. It is not an alternative resolution; it is a documented exception with a named residual holder.

Rotation and custody obligations, all from that section:

- `destroyRetiredInboxKey(alias)` in the same layer, zeroizing the secret and removing the descriptor's `retired` entry in one operation at retired-epoch TTL.
- Backup inclusion is the **live epoch alias only**. `/pub/hypercolor.app/v1/backup/latest` must not accumulate retired aliases, and the backup writer needs an explicit prune step, not just an append.
- Rotation is a user-reachable action, because it is the only response to a current-key compromise.

Also required in this repo:

- `src/types/inbox.ts` — descriptor + hint kinds, validators, `INBOX_DESCRIPTOR_PATH`, and **Unix-seconds** timestamp validators that reject millisecond-magnitude values outright rather than passing them through (F-10).
- `src/services/link/DropService.ts` — publish / rotate / destroy-retired / submit / challenge / fetch / batch-ack, including the §5.3 randomized ack delay and the §5.1 client side of the challenge request.
- `src/services/link/LinkService.ts` — the third candidate source in `collectInboxCandidates`, **and** the §5.2 subtraction: the `origin` column on `links`, the `INBOX_HINT_PROBE_LIMIT` exclusion, `PENDING_REQUEST_CAP` LRU admission, and `PENDING_REQUEST_TTL` age-out reusing `declineMessageRequest`'s teardown but deleting the row.
- `src/services/link/wotGate.ts` — synced to the upstream `a373cd1` policy, per §Context. **Phase B prerequisite.**
- `src/services/link/LinkService.ts` `routeHeldGroupInbound` — the pending-peer restriction on `group.membership` `op: 'create'` / `op: 'add'`, per §Threat model → *A pending stranger's group PAM*. **Phase B prerequisite.**
- The pending-request row UI — the §7 rendering constraints, including no background profile resolution and no peer-controlled image loads.
- A DB migration for the `links.origin` column, defaulting existing rows to `'contact'` so no established conversation is ever pruned by the new rule.

### 5. Append-only capability (Phase D, upstream) — `BitcoinErrorLog/pubky-core`

The primitive that makes the relay unnecessary:

- `pubky-common/src/capabilities.rs` — `Action::Append` (`'a'`): PUT to a non-existent key inside the scope; no DELETE, no overwrite.
- `pubky-homeserver/src/client_server/layers/authz.rs` — honour `Append` for PUT-if-absent, and permit a session-less append when the tenant advertises an open-append prefix.
- `pubky-homeserver/src/data_directory/quota_config/` — per-path anonymous rate limits and a per-prefix byte cap so an open-append prefix cannot consume the owner's whole quota. `LimitKeyType` already supports keying by IP.

This is an upstream proposal with a deployment dependency: it only helps Hypercolor if the operators we actually talk to run it. v1 must not assume they will (same posture ADR 0001 takes on session revocation).

## Wire-contract impact

Shared contract lives at `BitcoinErrorLog/hypercolor` and is vendored here as a pin (`vendor/hypercolor-wire-pin/`, `c7157aaa`, checked by `scripts/check-wire-drift.sh`). Runtime copies under `src/` carry a 2-line pin header.

**Additive. Not breaking, in either direction.**

| Change | Kind | Breaking? |
|---|---|---|
| `hypercolor.inbox.descriptor.v1` | New object at `/pub/hypercolor.app/v1/inbox/v1.json` | No. Inside the existing `/pub/hypercolor.app/v1/:rw` grant. No new Ring grant. |
| `hypercolor.inbox.hint.v1` | New sealed payload, drop layer only | No. Never appears on an Encrypted Link. |
| SB2 unlinkable profile | Field discipline, not a codec change | No. `pubky-crypto` codec untouched (the `MAX_CBOR_DEPTH` fix in §Required primitives 3b is a decoder hardening, not a format change). |
| PoW domain `"hypercolor-drop-pow/v1"` | New shared constant, preimage includes `epoch_hour` | No, but it must be identical on all four surfaces, **and all four must agree the timestamp is Unix seconds**. |
| All timestamps Unix **seconds** | Pins an existing ambiguity | No, but it corrects a millisecond example that appeared in an earlier draft of this ADR's descriptor schema. Any implementation written against that draft must be fixed. |
| `wotGate.ts` policy sync + `WotInput` field rename to `hasPriorRoutedConversation` | Aligns this tree to upstream `a373cd1` | Not on the wire, but it is in a pin-checked file and it is a **Phase B prerequisite**. |
| `links.origin` column | Device-local schema | Not on the wire. Needs a migration defaulting to `'contact'`. |
| `chat.message.v0`, `pubky_app.dm.v0`, PAM transport, DH path derivation, group wire kinds | **Unchanged** | — |
| `LinkStatus` / `LinkDeliveryState` gain `drop-queued` | Device-local state in a wire-pinned file | Not on the wire. Needs a coordinated pin bump because `src/types/link.ts` is pin-checked. |

Interop:

- **New client → old client:** the old client publishes no descriptor, so the send path reports `inbox closed` and falls back to the closed path. Same reachability as today, but the sender is now *told*.
- **Old client → new client:** the old client never posts a drop. Unaffected.
- **New client → new client:** cold open works.

No existing object changes shape, so no dual-read and no migration. Required coordination: a pin bump against `BitcoinErrorLog/hypercolor` covering `src/types/link.ts` and the new `src/types/inbox.ts`, mirrored into `vendor/hypercolor-wire-pin/src/`.

Cross-surface parity is already in place for the crypto: SB2 on web/Tauri via `paykit-wasm`, on iOS/Android via `pubky-noise` UniFFI. The only surface-specific work is InboxKey custody (native alias vs wasm memory) and the PoW binding.

## Phased implementation plan

Each phase has one proof. A skipped test is not a proof, and a green unit test is not a live proof.

### Phase A — descriptor only (no relay)

Publish, rotate, and delete `hypercolor.inbox.descriptor.v1`. Settings toggle: "Let strangers request a chat." Default **off**. Mint and store the InboxKey behind an alias per §Required primitives 4. Send path learns to fetch a descriptor and to report `inbox closed`. Nothing polls anything new. **Phase A is the only part of this ADR that is safe on this tree's current `wotGate.ts`**, because nothing new is ever probed.

**Proof:** with the toggle on, an unauthenticated `publicGet` from a second browser profile returns the descriptor and `computeInboxKid(inbox_x25519_pub)` equals the published `inbox_kid`. With it off, the object 404s. `collectInboxCandidates` output is byte-identical to before in both states, and no new peer appears in any queue. A send to a descriptor-less pubky shows `inbox closed` instead of a delivered message. The descriptor's `created_at` is a 10-digit Unix-seconds value, and a validator test rejects a millisecond-magnitude value. The InboxKey secret is not readable from JS — or, if the web build cannot achieve that, **the `SECURITY.md` web-custody section exists, names the fetch-and-delete consequence of XSS, and has been reviewed; the toggle does not ship on web until it does.**

### Phase B — single relay, end to end

**Prerequisites, both blocking:** `wotGate.ts` synced to the upstream `a373cd1` policy (§Context), and the `routeHeldGroupInbound` pending-peer restriction (§Threat model → *A pending stranger's group PAM*).

Deploy `hypercolor-drop`. Wire submit / challenge / fetch / batch-ack, PoW with the hour window, the two-tier per-KID cap and global eviction, the third candidate source and the §5.2 bounds, and the §7 request-row rules.

**Proof — the original five:** a stranger account with no shared history, no follow, and no manual add sends a message; the recipient's next sync surfaces a **pending message request**, not an accepted conversation. Accepting opens a normal Encrypted Link and the first body arrives from the **sender's own homeserver path**, verified by killing the relay before accept — the conversation still completes. A drop at `min_pow_bits - 1` returns `400 low-work` and never enters the queue. Submitting `WARM_KID_CAP + 1` drops to a warm KID returns `503 queue-full` on the last with the earlier drops intact and readable. A hint claiming `sender_pubky` of an uninvolved third party produces no request row and no contact row.

**Proof — added by the audit response:**

- **F-01 challenge key mismatch.** `POST /v1/challenge/{victim_kid}` carrying an attacker-generated `inbox_x25519_pub` returns `400 kid-mismatch` and no blob. The same request with the victim's real key returns a blob that the attacker cannot decrypt and the victim can. Grep the relay: no descriptor fetch, homeserver call, or pkarr resolve exists in any of the drop, challenge, fetch, or ack code paths.
- **F-02 local bounds.** Cycle 64 drops → ack → 64 more, ten times, from 640 distinct pubkys. `message_requests` holds at most `PENDING_REQUEST_CAP`. Set an unviewed pending row's `createdAt` past `PENDING_REQUEST_TTL`: the next sync deletes the row and its link state, and the row count drops. Register a hint-sourced peer that publishes a marker and a handshake, then stops responding: after `INBOX_HINT_PROBE_LIMIT` failed syncs the peer is absent from `collectInboxCandidates` output and **no further HTTP request is issued to that peer's homeserver** — asserted on the request log, not on the candidate list. An established peer and a manually-added peer with zero messages are still present after the same number of failures.
- **F-04 global cap.** Fill the relay with synthetic junk KIDs to `GLOBAL_KID_CAP` at `COLD_KID_CAP` each. A new legitimate KID can still accept a drop and complete a fetch, and the eviction that made room came from the deepest cold KID, not from a warm queue. A warm KID at capacity loses nothing while any cold KID holds drops. `GET /v1/info` reports every cap in §6.1.
- **F-05 PoW freshness.** A solution computed for `epoch_hour - 2` returns `400 stale-work`. The same blob resealed with a current `created_at` and re-solved is accepted. A solution computed at an hour boundary and submitted 90 seconds later, in the next hour, is accepted (two-bucket window).
- **F-08 receipt binding.** The `202` receipt verifies against the relay pubky **pinned in the descriptor**, and its `inbox_kid` and `BLAKE3(blob)` match the submitted drop. Altering one byte of the blob and re-submitting yields a receipt with a different `blob_hash`. A receipt from relay A does not verify against relay B's pinned key.
- **F-10 timestamp interop.** A blob sealed by the web client round-trips through the Rust relay's `Sb2::decode` with `created_at` and `expires_at` equal to the values the client set, both 10-digit, and the relay's window check passes. The same test with milliseconds returns `400`. Run on the wasm and the UniFFI surface.
- **F-12 CBOR depth.** A header with an unknown key whose value nests deeper than `MAX_CBOR_DEPTH` is rejected by `Sb2Header::decode`; a header with an unknown key holding a flat value still decodes.
- **F-15 group pre-accept.** The two assertions in §Threat model → *A pending stranger's group PAM*: `countLinkMessagesForPeer === 0` and `classifyInboundPeer === 'request'` after a pending peer's group PAMs; and no new `group_channels` row, no `group_members` row for the recipient, and no notification from a pending peer's `op: 'create'`, with all of it applying after accept.
- **§7 request row.** Open the pending list with ten pending rows: **zero** outbound requests to any peer homeserver or to Nexus. Open one row: exactly one resolution, for that peer. A profile `name` containing markup renders as literal text, and a profile `image` URL is not fetched.
- **§2 ephemeral key.** Two drops to the same recipient carry different `sender_peerid`, and neither equals the sender's receiver Noise public key. A drop with `recipient_peerid != sender_peerid` is refused by the relay and, independently, by the client.

### Phase C — hardening

Multi-relay fan-out and dedupe by `msg_id`; epoch rotation, `retired`, and retired-secret destruction; introduction tickets and `require_ticket`; the full sender feedback table; relay IP-retention window; the §6.3 challenge PoW lever.

**Proof:** with two relays listed, kill relay 1 — a drop still lands via relay 2 and is not double-surfaced. Rotate the epoch: drops to the retired KID are discarded locally, and the relay's retired queue empties at TTL. At retired-epoch TTL the retired secret is destroyed: `inboxKeyDecrypt` on that alias fails, the `retired` descriptor entry is gone, and **a backup written after rotation contains exactly one InboxKey alias.** With `require_ticket: true`, an unticketed drop is refused client-side and a ticket from an accepted contact is accepted at `min_pow_bits = 0`. Grep the relay for any route or field exposing per-drop fetch state, delete state, or warm/cold status: **none exists.** Acks observed at the relay arrive on a randomized delay uncorrelated with the recipient's sync, and a third party probing a full queue cannot resolve the poll instant better than the ack window. The sender UI shows `Request sent` and never a delivered or read state for a drop.

### Phase D — retire the relay (upstream, deployment-gated)

Propose `Action::Append` plus anonymous per-path limits to `BitcoinErrorLog/pubky-core`. If merged **and** deployed by the operators we use, the descriptor points `drops` at the recipient's own homeserver prefix and the relay becomes one optional mirror.

**Proof:** on a `pubky-testnet` homeserver built from the fork, an unauthenticated PUT into an append-scoped prefix succeeds; a DELETE in the same prefix returns 403; a second PUT to the same key returns 409; and the per-prefix byte cap refuses writes past its limit without touching the owner's remaining quota.

## Consequences

### Positive

- A stranger can reach you, gated by explicit accept.
- The silent-failure defect is fixed. `inbox closed`, `queued`, `rejected`, `rate limited` are all honest signals derived from the sender's own submission or from world-readable data.
- Message bodies never leave the pairwise DH-derived path. The drop layer holds no content, so the forward-secrecy gap covers metadata only.
- Payload cost stays on the sender's own quota and their own operator's rate limits.
- No new Ring grant, no pkarr write, no Nexus object, no new `Resource` variant, no change to `chat.message.v0` or the PAM transport.
- The accept gate, the closed path, and every established conversation are untouched. The whole feature is one toggle away from off.

### Negative

- **A third party learns that your inbox is being contacted.** The KID→pubky map is public, so a crawling relay recovers recipient identity. Volume, timing, and IPs are visible to it. The closed model had no third party at all.
- **A weak recipient-activity signal is available to anyone, not just the relay.** The `503→202` edge on an open submit endpoint is a coarse "when does this user sync" channel. Reduced to ~15-minute resolution by randomized batched acks and randomized relay headroom; not eliminated. Residual held by the recipient and disclosed in the toggle copy.
- **No forward secrecy for drops.** Compromise of an InboxKey secret reveals who tried to contact you during that epoch — and, because the same secret answers the relay's challenge, lets the holder **delete** your pending intros. Rotation bounds the window only if retired secrets are destroyed and excluded from backups, which this ADR now mandates.
- **A new secret class**, weakest on web (`SECURITY.md`: no OS keychain, XSS is full compromise for messaging). Phase A ships alias custody; a web exception, if needed, is gated on a reviewed `SECURITY.md` section.
- **A censorship chokepoint we do not fully close.** Multi-relay reduces it to collusion; the recipient cannot distinguish silence from suppression; the fallback is the closed path.
- **PoW is a floor, not a wall.** A funded attacker can keep a chosen user's queue full and can occupy a large share of the relay's global capacity with cold junk KIDs at hourly PoW cost. Bounded and hot-tunable, not prevented.
- **Local state needs its own bounds**, because the relay cap does not provide them. A cap, a TTL, and a probe-set prune rule are now load-bearing parts of the design rather than incidental hygiene.
- **An operational dependency**: a service someone must run, fund, and keep patched.
- **A pin bump** coordinated with `BitcoinErrorLog/hypercolor` covering `src/types/link.ts`, `src/types/inbox.ts`, and the `wotGate.ts` policy sync, plus propagating the `paykit-wasm` rc47 pin and a `links.origin` migration.

### Neutral

- Requires a Kimi sensitive-area audit before merge (new crypto, new key custody, new abuse surface).
- The relay learns nothing that a homeserver-descriptor crawler could not learn independently. That is a statement about how public the descriptor is, not a defence of the relay.

## Open questions

1. **Relay operator and funding.** `hypercolor-drop` on Railway under which account, with what caps and what abuse-response policy? Phase B cannot ship without an answer, and §6.1's global caps are now part of what must be answered.
2. **Does mobile's native layer expose SB2 today?** `pubky-noise` has the UniFFI exports, but `PaykitLinkNative` (`src/services/link/PaykitLinkNative.ts`) surfaces only link/receiver calls. Resolve: grep the mobile native module for `sb2Encrypt` / `computeInboxKid`; if absent, Phase A on mobile includes a native-module addition, not just JS.
3. **Default `min_pow_bits`.** 20 bits is a guess anchored to "sub-second on a phone." Needs measurement on the slowest supported device and on the wasm path before Phase B. Now doubly load-bearing: it is also the operator's lever against cold-KID namespace flooding (§6.1).
4. **Ticket format and issuer accountability.** Should a ticket name the issuer to the recipient (accountability, but it tells the recipient who vouched) or stay blind (privacy, but no way to rate-limit a spamming issuer)? Phase C decision.
5. **Descriptor availability under a homeserver ban.** A banned recipient's descriptor 404s and their inbox appears closed. Acceptable, or does the descriptor need a mirror? Note that a banned recipient also cannot receive over the pairwise path, so this may be moot.
6. **Retired-epoch TTL value.** The *mechanism* is now fixed — retain the retired secret for the TTL, destroy it at expiry, exclude it from backups (§Threat model → *Rotation*). The remaining question is only the number. It trades in-flight drop loss on rotation against how long a compromised-and-rotated epoch stays decryptable. Starting point: 7 days, matching the drop TTL, so no drop the relay still holds is undecryptable.
7. **Whether `WARM_KID_CAP` should scale with a recipient's observed fetch cadence.** A user who polls hourly needs less depth than one who opens the app weekly. Deferred because any per-KID adaptive behaviour risks becoming an observable signal about that recipient, which is the §6.1 constraint on not exposing warm/cold.

**Closed by this revision** (previously open, resolved rather than deferred): challenge key sourcing (§5.1); InboxKey alias vs hex — alias, with a gated web exception (§Required primitives 4); the global relay cap (§6.1); PoW freshness (§4); the receipt payload (§6.2); retired-secret destruction and backup pruning; request-row rendering (§7).

## Audit response

An external security review of the previous revision returned **DO-NOT-SHIP**. Every finding is resolved below: **fixed** in this document, **waived** with a named residual holder and a named unacceptability condition, or **rejected** with the evidence that contradicts it. Nothing is deferred to a note.

Findings confirmed by that review and left unchanged because they were already correct: the SB2 header carries both peer ids in cleartext outside the AEAD; the ephemeral-sender profile does break linkability at the crypto layer; hint spoofing is harmless because a request row still requires a real handshake at the named pubky's pairwise path; `Action::Write` is PUT/POST/DELETE and the self-hosted public-write prefix is correctly rejected; pointer-not-body, reject-not-evict within a KID, and PoW binding to KID plus blob hash are sound.

| ID | Severity | Resolution | Where |
|---|---|---|---|
| F-01 | HIGH | **Fixed.** Challenge is now `POST` carrying `inbox_x25519_pub`; the relay MUST verify `first_16(SHA256(key)) == path KID` and return `400 kid-mismatch`, MUST NOT accept an unverified key, and MUST NOT resolve recipient identity in any path. The takeover — attacker supplies own key, decrypts challenge, fetches and DELETEs the victim's queue — is spelled out so the check cannot be dropped as an optimisation. | §5.1, §6 route table, §Required primitives 1; Phase B proof |
| F-02 | HIGH | **Fixed.** The "bounded by the 64-drop cap" claim is withdrawn as false, with the cycling mechanism stated. Three bounds added: `PENDING_REQUEST_CAP` 256 LRU with unviewed-only eviction, `PENDING_REQUEST_TTL` 30 days age-out (deleting the row, not writing `declined`) plus 90-day declined retention, and exclusion of hint-sourced zero-message handshaking `links` rows from `collectInboxCandidates` after 3 failed syncs via a new `origin` column. The DoS table now separates relay-state from local-state bounds. | §5.2, §DoS table, §Required primitives 4; Phase B proof |
| F-03 | MED-HIGH | **Fixed as to mechanism, waived as to residual.** Batched acks at a 0–900 s randomized delay; relay keeps a randomized 0–8 slot reserve near cap. The feedback table now admits `503` leaks volume **and** a weak presence signal. **Residual: ~15-minute-resolution activity inference for an open inbox whose queue an attacker keeps full. Holder: the recipient**, disclosed in the toggle copy. Unacceptable if resolution ever beats the ack window — so the ack delay is normative, and any later change that acks promptly is a security regression. | §5.3, §Threat model → *recipient-activity oracle*, §Sender failure signal |
| F-04 | MEDIUM | **Fixed as to mechanism, waived as to residual.** `GLOBAL_DROP_CAP` / `GLOBAL_KID_CAP` published in `/v1/info`; global FIFO eviction with per-KID fairness draining the deepest and coldest first; two-tier cap with `COLD_KID_CAP` 4 for never-fetched KIDs versus `WARM_KID_CAP` 64, cutting the junk-namespace attack 16×; warm/cold never exposed on any route. **Residual: a funded attacker can still occupy a large share of global capacity at hourly PoW cost. Holder: the relay operator.** Unacceptable past 50% sustained cold occupancy, at which point the answer is a higher floor and then Phase D, not a bigger relay. | §6.1; Phase B proof |
| F-05 | MEDIUM | **Fixed.** PoW preimage gains `u64_be(epoch_hour)` derived from the blob's own `created_at`, so solutions expire hourly. Relay verifies the hour bucket (current or previous, to survive boundary crossings) **and** the difficulty. Stays non-interactive — no relay challenge, and the reasons are recorded. | §4 step 5, §6 accept rules, §Required primitives 2 |
| F-06 | MEDIUM | **Fixed, with the contract's position stated.** Mandatory: per-IP token bucket at 10/min burst 20, and a 5-second per-KID sealed-blob cache (the KID check still runs on every request, cache hit or miss). Optional and **off by default**: a challenge PoW floor, armed by the operator under attack, with its state published in `/v1/info`. Rationale for the default recorded — the floor taxes the recipient's own routine poll. | §6.3 |
| F-07 | MEDIUM | **Fixed.** Retired secrets retained for the retired-epoch TTL then destroyed and zeroized; backups carry the **live epoch alias only** with an explicit prune step. Current-key compromise is documented as enabling fetch-plus-delete — active silent censorship, not just disclosure — so rotation is a user-reachable action. Phase A picks **native-alias custody** explicitly; the web exception is a `SECURITY.md` release gate with the web user as named residual holder. | §Threat model → *Rotation*, §Required primitives 4; Phase A and C proofs |
| F-08 | MEDIUM | **Fixed.** Receipt is now `{relay_pubky, inbox_kid, BLAKE3(blob), drop_id, accepted_at, expires_at}`, with the reason each field is load-bearing. Still evidence of acceptance only, never delivery. | §6.2; Phase B proof |
| F-09 | MEDIUM | **Fixed, and made a requirement of this ADR.** New §7: pending rows render pubky plus locally-attested data only; profile and tag resolution on row-open only, never background, arrival, list-render, scroll, or prefetch; resolved fields are untrusted plain text with a self-asserted label, no markup, no links, no peer-controlled image loads, no verified affordance. Governs where it overlaps ADR 0003 item 4. | §7; Phase B proof |
| F-10 | LOW | **Fixed.** Unix **seconds** pinned in the descriptor JSON (the millisecond examples are corrected), the hint, the SB2 header, the PoW `epoch_hour`, and the relay receipt, with the failure mode explained. Validators must reject millisecond-magnitude values. PoW crate docs must state the unit. Round-trip interop test added on both the wasm and UniFFI surfaces. | §1, §3, §4, §Required primitives 2 and 4; Phase B proof |
| F-11 | LOW | **Rejected on the facts, replaced with the real risk.** The claim that the wasm surface cannot mint the ephemeral Ed25519 key is incorrect. The **stale rc44 vendored build already exports** `generateNoiseSecretKey()` (random 32-byte Ed25519 secret) and `noisePublicKeyFromSecret()`, which is `pubky::Keypair::from_secret(..).public_key().z32()` (`paykit-wasm/src/keys.rs:27-30`) — exactly the z-base-32 form `sb2Encrypt` accepts for `senderPeerid`. `ukd::generate_app_keypair` stays unbound because it is not needed. Nothing blocks Phase B. What is required instead is a misuse guard: an `ephemeralEd25519Keypair()` clarity wrapper, plus **mandatory** assertions that two drops differ in `sender_peerid` and that neither equals the sender's receiver Noise public key — the bug that matters is passing the durable receiver key as `sender_peerid`, which would silently destroy sealed-sender with no test failure. | §Required primitives 3a; Phase B proof |
| F-12 | LOW | **Fixed.** `MAX_CBOR_DEPTH` (`sealed_blob_v2.rs:32`) is confirmed unenforced — `skip_value` (`:498-545`) recurses through arrays and maps with no depth parameter. Enforce it or delete the constant; enforcing preferred. Blast radius stated honestly (bounded by `MAX_HEADER_LEN` 2048 and the 1 KiB drop cap, so ~2k frames — thin on a 1 MiB wasm stack, not fatal on the relay) rather than inflated. Nested-key rejection test and a flat-unknown-key forward-compatibility test added. | §Required primitives 3b; Phase B proof |
| F-13 | LOW | **Rejected, and the risk it would have hidden is escalated.** The audit read `wotGate.ts` from **upstream `a373cd1`** and attributed it to this tree. This tree's `src/services/link/wotGate.ts` carries the header `pin c7157aaa1b338dd1d8545e82f639007cba945631` and its `classifyInboundPeer` (`:63-71`) auto-accepts on `isMutual \|\| isFollowing \|\| addedManually`; its `WotInput` field is `hasEstablishedConversation`. The original note and ADR 0003's amendment were **correct**. Consequence: on this tree, opening the inbox would auto-accept any stranger the user follows, which follows import is designed to produce in bulk — so the `wotGate.ts` sync is promoted to a **Phase B prerequisite**. The "MUST NOT be re-introduced" injunction is kept and restated. | §Context → *This tree's gate is the older, wider one*; §Required primitives 4; Phase B prerequisites |
| F-14 | INFO | **Fixed — kept consciously, and said so.** One paragraph records that the signature authenticates nothing about the sender (header already AEAD-bound via `build_aad` `:718-726`; verifying key read from the header, so the check is self-referential), and that it is retained for cheap relay-side header-mutation rejection and for future attested-sender extensibility via `cert_id`. No text or UI string may present a valid `sig` as evidence about who sent a drop. | §2 |
| F-15 | **NEW — MEDIUM** | **Found while investigating the auditor's open caveat; fixed.** A pending stranger's `group.membership op:'create'` is applied pre-accept: `authorizeMembership` (`applyGroupInbound.ts:124-162`) requires only that the sender match the founder field of the channel id they chose, `applyMembership` (`:171-214`) adds the recipient to the roster (`:183-184`), and the channel then appears in `ChannelsScreen` with an attacker-chosen name, followed by attacker-chosen message bodies and a notification. The DM queue holds; the group list has no gate. Latent today only because strangers cannot be probed — **this ADR is what makes it reachable.** Fix: `routeHeldGroupInbound` must not apply `op:'create'` or recipient-subject `op:'add'` from a pending or unknown peer, deferring them via the mechanism it already uses for chat items. Phase B prerequisite. | §Threat model → *A pending stranger's group PAM*; §Required primitives 4; Phase B proof |

### Corrections folded in

1. **The "zeros wouldn't parse" rationale was shaky and is removed.** Measured: `ed25519_dalek::VerifyingKey::from_bytes(&[0u8; 32])` returns `Ok` with `is_weak() == true` — the all-zero `CompressedEdwardsY` decompresses because `y = 0` gives `x² = -1`, a quadratic residue mod 2²⁵⁵-19 — and `pkarr::PublicKey::try_from` fails only when that call fails (`pkarr-3.10.0/src/keys.rs:167-179`). Ephemeral keys are now justified on their own merits: a non-malleable signing key, no durable identity, and a one-comparison conformance check. Zeros are additionally shown to be *actively harmful*, since a small-order `sender_peerid` makes the signature forgeable under non-strict verification. (§2)
2. **`paykit-wasm` needs a pin propagation, not new exports.** Verified at `BitcoinErrorLog/paykit-rs-official` HEAD `a2999bf`: version `0.1.0-rc47`, and the built `pkg` already exports `computeInboxKid`, `sb2Encrypt`, `sb2Sign`, `sb2Decrypt`, `sb2VerifySignature`, `x25519GenerateKeypair`, `generateNoiseSecretKey`, `noisePublicKeyFromSecret`. Only `vendor/paykit-wasm/` (rc44) is stale. Task downgraded to copying `pkg` and updating `PROVENANCE.md`. Two refinements to the correction as received: the version is **rc47**, not rc46; and **`verifyAppCert` is not exported** at that HEAD — `ukd::verify_app_cert` has no wasm binding — which is fine, because §2 sets `cert_id: absent`. The genuinely-missing Ed25519 export named in F-11 turned out not to be missing either; see that row. (§Required primitives 3, 3a)

## Related decisions

- [ADR 0001](0001-group-as-pubky.md) — private DMs and groups; namespace table; capability model; revocation unavailable in v1.
- [ADR 0002](0002-public-chat-as-graph.md) — public rooms; Nexus is an untrusted accelerator; no DM facts in `/pub/pubky.app/`.
- [ADR 0003](0003-chat-architecture-roadmap.md) — execution order, amended below.
- [README](README.md) — namespace rule, updated for `/pub/hypercolor.app/v1/inbox/`.

### Amendment to ADR 0003

1. **Insert items 3a–3d** (this ADR's Phases A–D) immediately after item 3. They need no `/pub/pubky.app/` grant and do not gate items 1–3. 3a–3c may proceed in parallel with items 4–8; 3d is upstream and deployment-gated.
2. **Item 1's stated value is out of date.** It says inbound Encrypted Links from people the user follows auto-accept "as `classifyInboundPeer` already specifies." Upstream pin `a373cd1` narrowed auto-accept to `hasPriorRoutedConversation` and states that follow / mutual / manual add "MUST NOT be re-introduced as accept conditions." Follows import therefore delivers badges and ranking, **not** auto-accept, and its value as an inbox-enumeration workaround is superseded by 3a–3c. **This tree has not caught up**: `src/services/link/wotGate.ts` is still pin `c7157aaa` and still auto-accepts on follow / mutual / manual add. Item 1 and item 3b are therefore **coupled**: shipping follows import on the current gate and then opening the inbox produces bulk stranger auto-accept. Either the gate sync lands first, or item 1 stays off until 3b's prerequisites are met.
3. **Add to the rejected-increments table:** auto-accept for open-inbox drops; a message body in the drop layer; a public write-only session on the recipient's inbox prefix; `http-relay` as the drop point; payment-as-postage as the baseline; Nexus or scout as the inbox enumerator; a client-supplied InboxKey accepted without a KID check; background profile resolution for pending request rows; a prompt per-drop ack.
4. **Item 3b gains two blocking prerequisites** in `BitcoinErrorLog/hypercolor`: the `wotGate.ts` policy sync, and the `routeHeldGroupInbound` restriction on pre-accept group `op: 'create'` / recipient-subject `op: 'add'`.
5. **Item 3a's effort note is corrected.** It says Phase A "needs the vendored `paykit-wasm` rebuilt for `sb2Encrypt` / `sb2Sign` / `computeInboxKid`." Those exports exist in the official rc47 build; only this worktree's rc44 vendored copy is stale, so the task is a pin propagation. Phase A's descriptor and challenge-decrypt work runs on the current rc44 pin, which already exports `sb2Decrypt`.

## References

- Hypercolor (`BitcoinErrorLog/hypercolor`, pin `a373cd1`): `src/services/link/LinkService.ts` `collectInboxCandidates` (`:1361`), `syncInbox`, `syncPeerLocked` (`:1498`), `ensureLinkLocked` (`:897-940`), `adoptInboundHandshake` (`:1200`), `persistInboundWithoutRouting` (`:1381`), `routeHeldGroupInbound` (`:1403`), `holdAsMessageRequest` (`:1439`), `declineMessageRequest` (`:709`), `routeUnprocessedStreamItems` (`:1561`), `initiateHandshake`; `src/services/link/wotGate.ts` `classifyInboundPeer`; `src/services/group/applyGroupInbound.ts` `applyGroupInbound`, `authorizeInbound` (`:100`), `authorizeMembership` (`:124`), `applyMembership` (`:164`), `persistAdmitted` (`:443`); `src/services/group/GroupService.ts` `listChannels` (`:57`); `src/screens/main/ChannelsScreen.tsx` (`:46`); `src/types/group.ts` `parsePrivateChannelId` (`:156`); `src/services/StorageService.ts` `countLinkMessagesForPeer` (`:228`), `listMessageRequests` (`:273`), `countPendingMessageRequests` (`:295`), `insertInboundPrivateCreate` (`:1210`), `listGroupChannels` (`:1275`), `saveGroupMessage` (`:1388`), `insertLinkMessage` (`:2134`); `src/services/attachments/applyAttachmentInbound.ts` (`:210`); `src/services/link/PaykitLinkNative.ts`; `src/services/payments/proofVerify.ts` `verifyBolt11Preimage`; `src/types/link.ts` `LINK_RECEIVER_PATH`, `RING_GRANT_CAPABILITIES`, `HYPERCOLOR_WRITE_CAPABILITY`, `LINK_MESSAGE_MAX_BYTES`, `LinkStatus`, `LinkDeliveryState`, `LinkReceiver`; `src/services/homeserverOrigin.ts`
- This tree: `src/services/link/wotGate.ts` (pin `c7157aaa`, wider auto-accept table — **not** the upstream policy); `vendor/paykit-wasm/PROVENANCE.md` (`0.1.0-rc44`) and `vendor/paykit-wasm/paykit_wasm.d.ts`; `vendor/hypercolor-wire-pin/README.md`; `scripts/check-wire-drift.sh`; `SECURITY.md`
- `pubky-crypto`: `src/sealed_blob_v2.rs` — `Sb2`, `Sb2Header`, `compute_inbox_kid` (`:101-107`), `build_aad` (`:718-726`), `encrypt_params` (`:906-971`), `decrypt`, `verify_signature` (`:1106-1132`), `decode_header` (`:549`), `skip_value` (`:498-545`), `SB2_MAGIC`, `MAX_HEADER_LEN` (`:29`), `MAX_CBOR_DEPTH` (`:32`, declared and unenforced), `MAX_CBOR_KEYS`, `MAX_MSG_ID_LEN`, `Sb2Header.created_at` / `expires_at` doc comments (`:70-73`, Unix seconds); `src/sealed_blob.rs` `MAX_PLAINTEXT_SIZE`, `x25519_generate_keypair`; `src/ukd.rs` `KeyBinding`, `InboxKeyEntry`, `add_inbox_key`, `find_inbox_key`, `generate_app_keypair` (`:497`, unbound to wasm), `verify_app_cert`, `AppCert`
- `paykit-rs-official` (HEAD `a2999bf`, `paykit-wasm` `0.1.0-rc47`): `paykit-wasm/src/sb2.rs` `x25519_generate_keypair_js` (`:16-23`), `sb2_encrypt`, `sb2_sign`, `compute_inbox_kid`; `paykit-wasm/src/keys.rs` `noise_public_key_from_secret` (`:27-30`), `parse_public_key_z32_or_hex` (`:79-91`), `owner_peerid_bytes` (`:100-102`); `paykit-wasm/pkg/paykit_wasm.d.ts` (export list); `paykit-lib/src/pubky_routing.rs` `PAYKIT_PATH_PREFIX`, `PAYKIT_PRIVATE_PATH_PREFIX`, `receiver_marker_path`, `private_message_path_prefix`, `receiver_pair_path_domain`; `paykit-lib/src/encrypted_link/paths.rs` `compute_private_payment_paths`
- `pubky-noise`: `src/ffi/config.rs` `compute_inbox_kid`, `sb2_encrypt`, `sb2_sign`, `sb2_decrypt`, `x25519_generate_keypair`; `generated-swift/pubky_noise.swift`; `generated-kotlin/uniffi/pubky_noise/pubky_noise.kt`
- `pkarr` 3.10.0: `src/keys.rs` `impl TryFrom<&[u8]> for PublicKey` (`:167-179`) — delegates validity entirely to `ed25519_dalek::VerifyingKey::from_bytes`
- `ed25519-dalek` v2: `VerifyingKey::from_bytes`, `VerifyingKey::is_weak` — measured directly for the all-zero encoding (§2)
- `pubky-core`: `pubky-common/src/capabilities.rs` `Capability`, `Action`; `pubky-common/src/auth.rs` `AuthToken`; `pubky-homeserver/src/client_server/layers/authz.rs` `authorize`; `pubky-homeserver/src/client_server/layers/rate_limiter/layer.rs`; `pubky-homeserver/src/data_directory/quota_config/path_limit.rs` `PathLimit`, `limit_key.rs` `LimitKeyType`; `pubky-homeserver/src/persistence/files/user_quota_layer.rs`; `pubky-homeserver/src/persistence/sql/entities/session.rs`; `http-relay/src/http_relay.rs`; `pubky-sdk/src/actors/pkdns.rs` `publish_homeserver`; `e2e/src/tests/storage.rs` `unauthorized_put_delete`
- `pubky-app-specs`: `src/uri/resource.rs` `Resource`
- `pubky-nexus`: `nexus-watcher/src/events/mod.rs` `handle_put`
