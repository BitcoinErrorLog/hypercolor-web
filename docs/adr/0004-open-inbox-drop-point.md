# ADR 0004: Open Inbox — a Sealed Drop Point for First Contact

## Status

Proposed — 2026-08-31

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

Note for the roadmap: this tree's copied `wotGate.ts` is the older pin `c7157aaa`, whose table still auto-accepts on follow / mutual / manual add. ADR 0003 item 1 describes that older behaviour as a feature. It is no longer true upstream. See the amendment at the end of this ADR.

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
| Web / Tauri | `paykit-rs-official/paykit-wasm/src/sb2.rs` | `computeInboxKid`, `sb2Encrypt`, `sb2Sign`, `sb2Decrypt`, `sb2VerifySignature`, `x25519GenerateKeypair` |
| iOS / Android | `pubky-noise/src/ffi/config.rs` → `generated-swift/pubky_noise.swift`, `generated-kotlin/.../pubky_noise.kt` | `computeInboxKid`, `sb2Encrypt`, `sb2Sign`, `sb2Decrypt`, `x25519GenerateKeypair` |
| Relay (Rust) | `pubky-crypto::sealed_blob_v2` directly | all of it |

**Caveat that becomes a required task:** the pkg vendored into *this* tree (`vendor/paykit-wasm/`, version `0.1.0-rc44`, `PROVENANCE.md`) exports only `x25519GenerateKeypair`, `sb2VerifySignature`, and `sb2Decrypt`. `sb2Encrypt`, `sb2Sign`, and `computeInboxKid` exist in the official source but **not in the vendored build**. Re-vendoring is a prerequisite, not a detail.

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
  "created_at": 1772500000000,
  "drops": [
    { "url": "https://drop.hypercolor.to", "pubky": "<z-base32>" },
    { "url": "https://drop.eu.hypercolor.to", "pubky": "<z-base32>" }
  ],
  "policy": { "min_pow_bits": 20, "max_blob_bytes": 1024, "require_ticket": false },
  "retired": [{ "inbox_kid": "<32-hex>", "retired_at": 1770000000000 }]
}
```

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

**Why the placeholders are an ephemeral key and not zeros.** The wasm and UniFFI wrappers take these as strings and parse them into real public keys — `sb2_encrypt` calls `owner_peerid_bytes` and `peerid_bytes`, both routing through `parse_public_key_z32_or_hex` → `pkarr::PublicKey::try_from` (`paykit-wasm/src/keys.rs`). An arbitrary 32-byte pattern is not guaranteed to survive Ed25519 decompression, so the profile must supply values that are valid public keys by construction. Reusing the freshly generated ephemeral key satisfies that for free, reveals nothing (it is already in the header), and gives the recipient a cheap conformance check: **reject any drop where `recipient_peerid != sender_peerid`** — it is off-profile.

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
  "created_at": 1772500000000
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
5. Solve PoW: find `nonce` such that `BLAKE3("hypercolor-drop-pow/v1" || inbox_kid || BLAKE3(blob) || nonce)` has at least `max(relay_floor, descriptor.policy.min_pow_bits)` leading zero bits.
6. `POST /v1/drop/{inbox_kid}` to **every** URL in `drops`, with header `X-Hypercolor-Pow: {nonce}`.
7. Record per-relay outcome locally. Conversation state becomes `drop-queued` when at least one relay returned `202`.

### 5. Receive path

1. For each own descriptor epoch (current, plus `retired` still inside TTL), for each relay: `GET /v1/challenge/{inbox_kid}` → an SB2 blob sealed *to that KID*, with `owner_peerid` = that relay's pinned Ed25519 pubky and `canonical_path` = `/drop/v1/challenge/{inbox_kid}`. `sb2Decrypt` it with the InboxKey secret to recover a 32-byte nonce. Anyone may ask for a challenge; only the secret holder can answer it. Binding the AAD to the relay's own key means a challenge issued by one relay cannot be replayed against another.
2. `POST /v1/fetch/{inbox_kid}` with the nonce → the drop list.
3. For each drop: enforce size, `expires_at`, profile conformance (`recipient_peerid == sender_peerid`), and the client's own `min_pow_bits` (drops below the recipient's bar are discarded locally even if the relay accepted them); `sb2VerifySignature`; `sb2Decrypt`; parse `hypercolor.inbox.hint.v1`.
4. Add `sender_pubky` to the candidate set for this sync only. **This is the whole change to `collectInboxCandidates`** — a third source, alongside contacts and links, that does not persist a contact row.
5. The existing `syncPeerLocked` path runs untouched. `classifyInboundPeer` sees no `hasPriorRoutedConversation` and returns `request`. The peer lands in the request queue.
6. `DELETE /v1/drop/{inbox_kid}/{drop_id}` with the same nonce, freeing relay quota. If the poll found nothing at the sender's path, the drop is dropped locally with no state kept and no contact row created — a spoofed hint leaves no residue.

Ordering does not exist in this layer, because the layer carries no content. All ordering, dedupe, and read-checkpoint logic stays in the PAM stream, which already dedupes by `(owner_pubky, sender_pubky, kind, event_id)`.

### 6. Relay contract (`hypercolor-drop`)

| Route | Auth | Semantics |
|---|---|---|
| `POST /v1/drop/{inbox_kid}` | open + PoW | accept a sealed blob |
| `GET /v1/challenge/{inbox_kid}` | open | SB2-sealed nonce for that KID, AAD-bound to this relay's pubky |
| `POST /v1/fetch/{inbox_kid}` | decrypted nonce | list drops |
| `DELETE /v1/drop/{inbox_kid}/{drop_id}` | decrypted nonce | ack and free quota |
| `GET /v1/info` | open | relay Ed25519 pubky, PoW floor, caps — so a descriptor entry can be checked |

Accept rules for `POST /v1/drop`:

- `Sb2::is_sb2` and `Sb2::decode` succeed, and `header.inbox_kid` equals the path parameter.
- Profile conformance: `header.recipient_peerid == header.sender_peerid`, `purpose == "hypercolor-intro"`, `sig` present → else `400`. Cheap, and it keeps off-profile (identity-leaking) blobs out of the store entirely.
- `body.len() <= 1024` → else `413`.
- `expires_at` within `[now, now + 7 days]`, `created_at` not in the future → else `400`.
- PoW verifies at the relay floor → else `400`. Verified from the blob bytes alone; no descriptor lookup, so the relay never resolves the recipient's pubky.
- `msg_id` not already present under this KID → else `409` (idempotent).
- Per-KID queue below cap (**64 drops / 64 KiB**) → else `503 queue-full`. **Reject, never evict.** Eviction would let a flooder flush honest drops, which is worse than refusing the flooder.
- Per-IP token bucket → else `429`.
- `202` carries `{ drop_id, expires_at }` and a relay Ed25519 signature over them, so the sender holds evidence of acceptance.

Explicitly **not** offered, and this is a security requirement rather than an omission: any endpoint revealing whether a drop was fetched, when it was fetched, or that it was deleted. A signed `202` proves the relay took it. Nothing proves the recipient read it.

Deployment: Railway, per the workspace deployment-targets rule. Storage is a keyed queue with TTL; no user table, no accounts, no logs beyond the rate-limit window.

## Threat model

### Spam and flooding

The queue is the target, and the queue is bounded. Four layers, honestly rated:

**Proof of work — a floor, not a wall.** Client-side, relay-verifiable, recipient-verifiable, needs no identity and no payment. At 20 bits a phone spends well under a second. That stops a script in a loop. It does not stop a botnet or a rented GPU: 20 bits is ~1M hashes, which is nothing at scale. Anyone claiming PoW solves messaging spam is selling something. Its actual job is to make the *trivially cheap* attack not free, and to give the recipient a knob (`min_pow_bits`) they can raise under attack without any coordination.

**Per-KID caps — the real bound.** 64 drops per inbox, reject-not-eject. The worst outcome of a successful flood is a request queue with 64 junk rows and honest strangers seeing `503 queue-full` — degraded, visible, self-healing on ack or TTL. Compare against the alternative failure mode where an attacker *displaces* real requests. Reject-not-eject is the difference between "annoying" and "an eviction attack."

**Introduction tickets — the escape hatch under attack.** An already-accepted contact mints a ticket: a short signed statement naming the introduced pubky and an expiry, carried inside the sealed hint. A ticketed drop bypasses PoW and is rate-limited per issuer. A recipient under attack sets `require_ticket: true` and their inbox becomes warm-intro-only without going fully closed. This needs no new Pubky primitive — the issuer already has an Encrypted Link to the recipient, and the ticket is verified against the recipient's own accepted-contact table.

**Payment (Paykit) — rejected as the baseline, kept as a tier.** Evaluated seriously because this app has a payments layer, and it does not hold up:

- Offline verification is impossible for a stranger. `verifyBolt11Preimage` (`src/services/payments/proofVerify.ts`) checks a preimage against a `payment_hash` **the recipient already possesses from an invoice they issued**. A stranger has no such invoice. A static endpoint (`/pub/paykit/v0/{receiver}/endpoints/`) yields a payment that is not bound to this drop and cannot be checked without asking the recipient's own node — an online oracle that correlates payment to contact attempt.
- Even if bound, "pay to say hello" excludes users without funds and links a payment record to a contact attempt.

So: payment is coherent only as an **optional priority tier** a recipient may enable for high-volume accounts, and only once a drop-bound payment proof exists. That proof is a new primitive and is not on this ADR's critical path.

**What we are not claiming.** None of this stops a determined, funded attacker from keeping 64 junk rows in a specific user's queue. The design goal is that this is *bounded, visible, and reversible* — cap it, raise the bar, require tickets, or close the inbox and fall back to manual add. Every one of those is one toggle, no migration.

### Storage exhaustion and DoS

Who pays what:

| Cost | Bearer | Cap |
|---|---|---|
| Sealed drop | relay operator | 1 KiB × 64 per KID, 7-day TTL, plus a global cap |
| Message payload | **the sender**, on the sender's own tenant | sender's `user_quota_bytes`, sender homeserver's `PathLimit` |
| Descriptor | recipient's own tenant | one object, a few hundred bytes |
| Request row | recipient's device | local SQLite, bounded by the 64-drop cap |

The important line is the second. Flooding *bodies* costs an attacker their own homeserver quota and trips their own operator's rate limits — an existing enforcement point we inherit for free by keeping payloads on the sender's tenant. An attacker who wants to flood 10,000 users with real message bodies must store 10,000 payloads under their own quota. That is the single best anti-abuse property in the design, and it is a direct consequence of not building a mailbox.

Relay availability is a real DoS surface. Losing the relay costs *new first contact only*. Established conversations are untouched; they never route through it.

### Metadata leakage

What the relay learns, precisely:

| Learns | Notes |
|---|---|
| An `inbox_kid` | Not given the recipient's pubky. But the KID→pubky map is **public** in world-readable descriptors, so a relay that crawls homeservers recovers it. **Treat recipient identity as exposed to the relay.** |
| That drops exist for that KID, when, how many, and their size | Size is constant by design, so volume and timing only. |
| Submitter IP, fetcher IP | The strongest deanonymiser here. We do not defeat a network observer. Tor/VPN is the user's mitigation, and the relay must not retain IPs beyond the rate-limit window. |
| Sender pubky | **No.** Sealed, and the header carries only a throwaway key. |
| Message content | **No.** It never enters the drop layer. |
| Social graph | Only "N strangers contacted this KID." Not who. |

Against Signal's sealed sender: comparable on sender identity (their server does not learn the sender for sealed-sender messages; ours does not either), **worse** on recipient identity (their account↔KID equivalent is not world-published; ours is, by construction — a stranger must be able to find your address), **better** on enrolment (no phone number, no account, no server-side identity at all).

Against the current closed model: the closed model wins outright on metadata. There is no third party, and a sender's outbound attempts are invisible even to their own homeserver operator, because the paths are DH-derived hashes over opaque ciphertext. **Opening the inbox introduces a third party that learns your inbox is being contacted.** That is the price, it is real, and the mitigation is that the price is opt-in per user and the fallback needs no relay.

Against a naive SB2 drop (profile ignored): far better. The default SB2 header names both parties in cleartext, so a naive relay would hold a plaintext social graph of who messages whom. The profile in §2 is not a nicety.

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
| `rejected: work too low` / `too large` / `duplicate` | `400` / `413` / `409` | No |
| `rejected: inbox full` | `503 queue-full` | Volume only, not identity or presence |
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
| `src/routes/drop.rs` | `POST /v1/drop/{inbox_kid}` with the accept rules in §6 |
| `src/routes/fetch.rs` | `GET /v1/challenge`, `POST /v1/fetch`, `DELETE /v1/drop/{kid}/{id}`, `GET /v1/info` |
| `src/store.rs` | per-KID capped queue, TTL sweeper, `msg_id` idempotency index |
| `src/pow.rs` | thin wrapper over the shared PoW crate |
| `src/receipt.rs` | relay Ed25519 signing of `202` payloads |

Depends on `pubky-crypto` (`sealed_blob_v2` for the challenge, shared PoW). No user table, no accounts.

### 2. Shared proof-of-work — `BitcoinErrorLog/pubky-crypto`, new `src/drop_pow.rs`

One canonical implementation over BLAKE3 with domain `"hypercolor-drop-pow/v1"`, exported from `src/lib.rs`. Web, iOS, Android, and the relay must agree bit-for-bit; four independent implementations would diverge and the divergence would present as unexplained rejected drops.

Bindings, both thin:

- `BitcoinErrorLog/paykit-rs-official` — new `paykit-wasm/src/pow.rs`, `dropPowSolve` / `dropPowVerify`, registered in `paykit-wasm/src/lib.rs`.
- `BitcoinErrorLog/pubky-noise` — `src/ffi/config.rs`, UniFFI `drop_pow_solve` / `drop_pow_verify`, regenerating `generated-swift/` and `generated-kotlin/`.

### 3. Re-vendor `paykit-wasm` with the SB2 encrypt surface

`vendor/paykit-wasm/` in this tree is `0.1.0-rc44` and exports only `x25519GenerateKeypair`, `sb2VerifySignature`, `sb2Decrypt`. The send path needs `sb2Encrypt`, `sb2Sign`, and `computeInboxKid`, which exist in `paykit-rs-official/paykit-wasm/src/sb2.rs` but are not in the vendored build. Rebuild `paykit-wasm/pkg`, re-vendor, and update `vendor/paykit-wasm/PROVENANCE.md`.

### 4. InboxKey custody — `BitcoinErrorLog/hypercolor`

The InboxKey X25519 secret is a **new secret class**. It must be held the way the receiver Noise secret is held: minted natively and referenced by an opaque alias, never materialised in JS (`src/types/link.ts` `LinkReceiver`: "the Noise secret NEVER enters JS").

`x25519GenerateKeypair` returns `{ publicKey, secretKey }` as hex **into the caller** — on web that means into JS memory, which is a regression against the receiver-alias pattern and against `SECURITY.md`. Two acceptable resolutions, and Phase A must pick one explicitly rather than drift into the weaker one:

- Mint and store the InboxKey behind an alias in the native/wasm layer, adding `mintInboxKey(sessionAlias)` and `inboxKeyDecrypt(alias, blob)` to `paykit-wasm/src/sb2.rs` and the `pubky-noise` FFI. Preferred.
- Accept web-only custody weakness, document it in `SECURITY.md`, and ship the alias form on mobile first.

Also required in this repo: `src/types/inbox.ts` (descriptor + hint kinds, validators, `INBOX_DESCRIPTOR_PATH`), `src/services/link/DropService.ts` (publish / rotate / submit / challenge / fetch / ack), the third candidate source in `collectInboxCandidates` (`src/services/link/LinkService.ts`), and inclusion of the InboxKey alias in `/pub/hypercolor.app/v1/backup/latest`.

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
| SB2 unlinkable profile | Field discipline, not a codec change | No. `pubky-crypto` untouched. |
| PoW domain `"hypercolor-drop-pow/v1"` | New shared constant | No, but it must be identical on all four surfaces. |
| `chat.message.v0`, `pubky_app.dm.v0`, PAM transport, DH path derivation | **Unchanged** | — |
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

Publish, rotate, and delete `hypercolor.inbox.descriptor.v1`. Settings toggle: "Let strangers request a chat." Default **off**. Mint and store the InboxKey per §Required primitives 4. Send path learns to fetch a descriptor and to report `inbox closed`. Nothing polls anything new.

**Proof:** with the toggle on, an unauthenticated `publicGet` from a second browser profile returns the descriptor and `computeInboxKid(inbox_x25519_pub)` equals the published `inbox_kid`. With it off, the object 404s. `collectInboxCandidates` output is byte-identical to before in both states, and no new peer appears in any queue. A send to a descriptor-less pubky shows `inbox closed` instead of a delivered message.

### Phase B — single relay, end to end

Deploy `hypercolor-drop`. Wire submit / challenge / fetch / ack, PoW, and the third candidate source.

**Proof:** a stranger account with no shared history, no follow, and no manual add sends a message; the recipient's next sync surfaces a **pending message request**, not an accepted conversation. Accepting opens a normal Encrypted Link and the first body arrives from the **sender's own homeserver path**, verified by killing the relay before accept — the conversation still completes. A drop at `min_pow_bits - 1` returns `400` and never enters the queue. Submitting 65 drops to one KID returns `503 queue-full` on the 65th with the first 64 intact and readable. A hint claiming `sender_pubky` of an uninvolved third party produces no request row and no contact row.

### Phase C — hardening

Multi-relay fan-out and dedupe by `msg_id`; epoch rotation and `retired`; introduction tickets and `require_ticket`; the full sender feedback table; relay IP-retention window.

**Proof:** with two relays listed, kill relay 1 — a drop still lands via relay 2 and is not double-surfaced. Rotate the epoch: drops to the retired KID are discarded locally, and the relay's retired queue empties at TTL. With `require_ticket: true`, an unticketed drop is refused client-side and a ticket from an accepted contact is accepted at `min_pow_bits = 0`. Grep the relay for any route or field exposing per-drop fetch or delete state: **none exists.** The sender UI shows `Request sent` and never a delivered or read state for a drop.

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
- **No forward secrecy for drops.** Compromise of an InboxKey secret reveals who tried to contact you during that epoch.
- **A new secret class**, weakest on web (`SECURITY.md`: no OS keychain, XSS is full compromise for messaging).
- **A censorship chokepoint we do not fully close.** Multi-relay reduces it to collusion; the recipient cannot distinguish silence from suppression; the fallback is the closed path.
- **PoW is a floor, not a wall.** A funded attacker can keep 64 junk rows in a chosen user's queue.
- **An operational dependency**: a service someone must run, fund, and keep patched.
- **A pin bump** coordinated with `BitcoinErrorLog/hypercolor`, plus a re-vendored `paykit-wasm`.

### Neutral

- Requires a Kimi sensitive-area audit before merge (new crypto, new key custody, new abuse surface).
- The relay learns nothing that a homeserver-descriptor crawler could not learn independently. That is a statement about how public the descriptor is, not a defence of the relay.

## Open questions

1. **Relay operator and funding.** `hypercolor-drop` on Railway under which account, with what cap and what abuse-response policy? Phase B cannot ship without an answer.
2. **Does mobile's native layer expose SB2 today?** `pubky-noise` has the UniFFI exports, but `PaykitLinkNative` (`src/services/link/PaykitLinkNative.ts`) surfaces only link/receiver calls. Resolve: grep the mobile native module for `sb2Encrypt` / `computeInboxKid`; if absent, Phase A on mobile includes a native-module addition, not just JS.
3. **InboxKey alias or hex?** Preferred is a native alias (§Required primitives 4). Confirm `paykit-wasm` can hold the secret outside JS-visible memory in a browser at all; if it cannot, the web build ships with a documented custody weakness and that must be an explicit product decision, not a default.
4. **Default `min_pow_bits`.** 20 bits is a guess anchored to "sub-second on a phone." Needs measurement on the slowest supported device and on the wasm path before Phase B.
5. **Ticket format and issuer accountability.** Should a ticket name the issuer to the recipient (accountability, but it tells the recipient who vouched) or stay blind (privacy, but no way to rate-limit a spamming issuer)? Phase C decision.
6. **Descriptor availability under a homeserver ban.** A banned recipient's descriptor 404s and their inbox appears closed. Acceptable, or does the descriptor need a mirror? Note that a banned recipient also cannot receive over the pairwise path, so this may be moot.
7. **Retired-epoch TTL.** How long to keep polling a retired KID before a rotation silently drops in-flight drops?

## Related decisions

- [ADR 0001](0001-group-as-pubky.md) — private DMs and groups; namespace table; capability model; revocation unavailable in v1.
- [ADR 0002](0002-public-chat-as-graph.md) — public rooms; Nexus is an untrusted accelerator; no DM facts in `/pub/pubky.app/`.
- [ADR 0003](0003-chat-architecture-roadmap.md) — execution order, amended below.
- [README](README.md) — namespace rule, updated for `/pub/hypercolor.app/v1/inbox/`.

### Amendment to ADR 0003

1. **Insert items 3a–3d** (this ADR's Phases A–D) immediately after item 3. They need no `/pub/pubky.app/` grant and do not gate items 1–3. 3a–3c may proceed in parallel with items 4–8; 3d is upstream and deployment-gated.
2. **Item 1's stated value is out of date.** It says inbound Encrypted Links from people the user follows auto-accept "as `classifyInboundPeer` already specifies." Upstream pin `a373cd1` narrowed auto-accept to `hasPriorRoutedConversation` and states that follow / mutual / manual add "MUST NOT be re-introduced as accept conditions." Follows import therefore delivers badges and ranking, **not** auto-accept, and its value as an inbox-enumeration workaround is superseded by 3a–3c.
3. **Add to the rejected-increments table:** auto-accept for open-inbox drops; a message body in the drop layer; a public write-only session on the recipient's inbox prefix; `http-relay` as the drop point; payment-as-postage as the baseline; Nexus or scout as the inbox enumerator.

## References

- Hypercolor (`BitcoinErrorLog/hypercolor`, pin `a373cd1`): `src/services/link/LinkService.ts` `collectInboxCandidates`, `syncInbox`, `initiateHandshake`; `src/services/link/wotGate.ts` `classifyInboundPeer`; `src/services/link/PaykitLinkNative.ts`; `src/services/payments/proofVerify.ts` `verifyBolt11Preimage`; `src/types/link.ts` `LINK_RECEIVER_PATH`, `RING_GRANT_CAPABILITIES`, `HYPERCOLOR_WRITE_CAPABILITY`, `LINK_MESSAGE_MAX_BYTES`, `LinkStatus`, `LinkDeliveryState`, `LinkReceiver`; `src/services/homeserverOrigin.ts`
- This tree: `vendor/paykit-wasm/PROVENANCE.md` (`0.1.0-rc44`); `vendor/hypercolor-wire-pin/README.md`; `scripts/check-wire-drift.sh`; `SECURITY.md`
- `pubky-crypto`: `src/sealed_blob_v2.rs` — `Sb2`, `Sb2Header`, `compute_inbox_kid`, `build_aad`, `encrypt_params`, `decrypt`, `verify_signature`, `SB2_MAGIC`, `MAX_MSG_ID_LEN`; `src/sealed_blob.rs` `MAX_PLAINTEXT_SIZE`, `x25519_generate_keypair`; `src/ukd.rs` `KeyBinding`, `InboxKeyEntry`, `add_inbox_key`, `find_inbox_key`, `AppCert`
- `paykit-rs-official`: `paykit-wasm/src/sb2.rs`; `paykit-wasm/src/keys.rs` `parse_public_key_z32_or_hex`, `owner_peerid_bytes`; `paykit-lib/src/pubky_routing.rs` `PAYKIT_PATH_PREFIX`, `PAYKIT_PRIVATE_PATH_PREFIX`, `receiver_marker_path`, `private_message_path_prefix`, `receiver_pair_path_domain`; `paykit-lib/src/encrypted_link/paths.rs` `compute_private_payment_paths`
- `pubky-noise`: `src/ffi/config.rs` `compute_inbox_kid`, `sb2_encrypt`, `sb2_sign`, `sb2_decrypt`, `x25519_generate_keypair`; `generated-swift/pubky_noise.swift`; `generated-kotlin/uniffi/pubky_noise/pubky_noise.kt`
- `pubky-core`: `pubky-common/src/capabilities.rs` `Capability`, `Action`; `pubky-common/src/auth.rs` `AuthToken`; `pubky-homeserver/src/client_server/layers/authz.rs` `authorize`; `pubky-homeserver/src/client_server/layers/rate_limiter/layer.rs`; `pubky-homeserver/src/data_directory/quota_config/path_limit.rs` `PathLimit`, `limit_key.rs` `LimitKeyType`; `pubky-homeserver/src/persistence/files/user_quota_layer.rs`; `pubky-homeserver/src/persistence/sql/entities/session.rs`; `http-relay/src/http_relay.rs`; `pubky-sdk/src/actors/pkdns.rs` `publish_homeserver`; `e2e/src/tests/storage.rs` `unauthorized_put_delete`
- `pubky-app-specs`: `src/uri/resource.rs` `Resource`
- `pubky-nexus`: `nexus-watcher/src/events/mod.rs` `handle_put`
