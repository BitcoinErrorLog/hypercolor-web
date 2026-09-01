# Decisions and audit waivers

## Kimi web session/SW audit close-out (branch fix/sw-rsc-chats-nav, final verdict SHIP at bf41ee2)

The blocking finding (orphaned receiver secret from a failed marker
publish reading as "enabled" forever) was fixed by the scoped rollback
in `provisionReceiver`. The following non-blocking findings are waived
in writing:

**Revoked session shows "Session offline" until sign-out.** A grant
that can never resume (unauthorized / pubky mismatch / scope missing)
keeps its durable evidence and reports `session-offline` rather than
downgrading to `needs-enable`. Recovery is the sign-out button. Waived:
fail-safe direction (never silently discards a working receiver), and
auto-downgrade risks discarding a valid grant on a transient
misclassification. Revisit if support burden appears.

**Pagehide tail-write window.** `closeDb` on pagehide flushes
persistently after every mutating statement, but a page killed
mid-write can lose the final mutation(s) since the last flush. Waived:
bounded to the tail, no cross-account or security impact.

**Crash-mid-provision orphan (crash-class residual).** A tab death
inside the ~15s publish window, or a throw inside `mintReceiver`
between the KeyStore write and the SQL write, can still leave an
orphaned secret that reads as "enabled" until the user re-runs Enable.
No in-process rollback can cover process death. Waived: crash-in-a-
narrow-window frequency (vs. the fixed finding's routine-network-
failure certainty); the accepted fix if it ever bites is
publish-then-persist ordering in `mintReceiver`, which converts the
crash window to fail-closed. A self-heal inside `getEnableStatus` was
rejected because it would reintroduce the SQLite read that previously
wedged the Enable CTA behind a DB lock.

**Preview-URL cache keying.** The service worker keys cached
navigations by full URL, including `?x-vercel-protection-bypass=` on
preview deployments. Harmless on production, same-device only.

**Alias future-proofing nit.** `rollbackUnpublishedReceiver` deletes
the default receiver alias while the reuse path reads
`existing.receiverAlias`; every writer uses the default alias today.
Tighten if a second alias writer ever appears.

## F3 (Kimi paykit-wasm rc48): ratchet rollback + keystream reuse is unreachable

Kimi asked whether a failed send that advanced the in-memory ratchet, then
a restart that restored the pre-send snapshot, could re-encrypt a
*different* plaintext under the same chain key / nonce (keystream reuse),
especially in the 2xx-headers / body-error window.

**Verdict: structurally unreachable.** Transport send does not mutate
nonce, slot, or cipher state until the homeserver `put()` returns `Ok`.
A failed send leaves in-memory state identical to the persisted
pre-send snapshot. Retry encrypts the same queued `wireJson` (same
plaintext) at the same nonce and write slot. There is no rollback
across an attempted send, and no second plaintext at that nonce from
restore-from-snapshot.

Evidence chain (`pubky-noise` 0.1.0-rc5, the crate `paykit-lib` calls):

1. `DataLinkContext::write_act` transport arm
   (`snow_crypto.rs:676-688`) takes `&self` on the transport object
   (`as_ref()`), encrypts with the *current* `sending_nonce` as a
   parameter, and does **not** increment the nonce. Comment at
   `snow_crypto.rs:684-687`: caller must increment only after the
   write is confirmed.
2. `PubkyNoiseEncryptor::send_message` (`lib.rs:452-496`):
   - `write_act(plaintext)` at `lib.rs:467-470`
   - `storage().put(...)` at `lib.rs:481-486`
   - `increment_sending_nonce` + `increment_write_counter` only after
     `put` `Ok` (`lib.rs:487-495`)
   - `put` `Err` → `HomeserverWriteError` with nonce/slot unchanged
3. Paykit retries the **same** plaintext on `HomeserverWriteError`
   (`paykit-lib/.../private_application_message.rs:320-336`). Each
   retry is another `send_message(plaintext)` against un-advanced
   state → same nonce, same slot, same ciphertext.
4. wasm handle is replaced even on error
   (`paykit-wasm/src/link.rs:320-327`), so the in-memory link after a
   failed send is the un-advanced encryptor.
5. Web persists a snapshot only after a successful send:
   `PaykitLinkWeb.sendPrivateMessageJson` (`PaykitLinkWeb.ts:751-756`)
   calls `persistHandleSnapshot` only after
   `sendPrivateApplicationMessageJson` resolves;
   `LinkService.dispatchPreparedDm` / `deliverQueuedPayload` /
   `attemptPersistedSend` call `finalizeLinkSend` only after that
   returns. A failed send does not write a post-encrypt snapshot.
6. Retry payload is the original `rawJson` (`LinkService.ts`
   `retryPayload` / queue item). Restore + retry re-encrypts that
   same plaintext, not a new message.

Restore-from-snapshot therefore cannot roll back *across* an
attempted transport send, because the send never advanced durable or
in-memory ratchet state on failure. The 2xx-body-timeout window
(F2) now returns `RequestError::Timeout` from the drain; `put` maps
that to `HomeserverWriteError`; nonce still does not advance; the
write stays owed and retries the same ciphertext onto the same slot.

The F2 typed-timeout path manufactures the case this waiver originally
declined to claim: a 2xx write that the client records as failure
leaves nonce and slot un-advanced. A *new* encrypt for that peer
before the owed retry would reuse the nonce. That hole is closed by
retry-first ordering (see below). Restore-from-snapshot remains
unreachable as documented above.

## R2-F1 (Kimi round 2): retry-first before a new same-peer encrypt

**Decision:** after `withQueue(peer)` is held and before any new
plaintext is encrypted for that peer (`dispatchPreparedDm`,
`sendPersistedLinkJson`, `attemptPersistedSend` — including group
fan-out, which shares the same Encrypted Link nonce sequence), drain
every owed same-peer queue item oldest-first. Only if that drain
returns `clear` (each item `sent` or already `settled`) may the new
message be encrypted.

If an owed retry is still unsuccessful — transient `deferred`,
non-transient `failed`, retired-and-parked, or claimed in-flight by
another pass — the new encrypt is **blocked**. The new row is marked
`failed` (still owed via its queue item) and is not sent. Never
encrypt a second plaintext at a nonce a prior undelivered `wireJson`
already used.

Retired items are **parked** via `RetryQueue.park` (writes
`next_retry_at` directly to ~1 year out). `defer` cannot do this:
its second argument is `currentAttempts`, and `nextRetryMs` caps at
30 minutes. The interval drain skips parked items (`getDue` uses
`next_retry_at`); the send-path drain still sees them via
`listDeliveryQueue` and either completes the write or keeps blocking
new encrypts.

Group fan-out to a peer is the same nonce sequence as DMs to that
peer (`sendPrivateMessageJson` on the same handle). Fan-out therefore
runs the same retry-first drain.

**Attachment reconstruction:** `reconstructAttachmentWireJson` is
deterministic given unchanged KeyStore state (same redacted envelope
+ same secret → same `JSON.stringify`). Eviction throws `not-found`.
Retry payloads persist `secretFingerprint` (SHA-256 of key/nonce/
algorithm/thumbnail). A rotated secret fails closed with
`validation` — the retry never reaches `sendPrivateMessageJson`.
Legacy payloads without a fingerprint still fail on eviction; they
cannot detect rotation and must not be treated as a license to
re-encrypt blindly once a fingerprint exists.

## R2-F4: one drain pass at a time, per-item claims

Drain/recover loops share a module-level promise chain so only one
pass's loop runs. Per-item 20s budget still detaches a wedged send
so the pass cannot latch on one peer. Each queue item is claimed
with a timestamp (`DRAIN_CLAIM_TTL_MS` = 60s) so a second pass
cannot re-send or double-`recordFailure` an in-flight item. An
expired claim can be stolen; the per-peer mutex still serializes
the actual PUT. Fan-out re-checks `getGroupMessage` sent-state and
whether the queue row still exists before sending.

## R3-F1 (Kimi round 3): per-peer oldest-first inside every delivery

The send-path drain (R2-F1) was not enough. `drainRetries` /
`recoverPendingSends` delivered in `getDue` / `nextRetryAt` order.
Sequence: A owed at nonce N (ambiguous commit, deferred with
backoff); B blocked pre-encrypt and marked owed with
`nextRetryAt = now`; the next interval pass delivered B first and
encrypted B at N.

**Decision:** two layers, both inside `withQueue(peer)`:

1. Pass-level: group by peer, process each peer's items strictly
   oldest-first (`createdAt`, then `id`). Covers group fan-out
   (same nonce sequence as DMs to that peer) when both items are due.
2. Delivery-level: `deliverQueuedPayloadLocked` runs
   `drainOwedSamePeerWritesLocked({ beforeItem })` before any
   sent-state / retire / encrypt work. The older-owed scan uses
   `listDeliveryQueue`, not `getDue`, so an item that is not due
   (A on backoff) still precedes a newer item that is due (B). If
   that drain is not `clear`, the current item is deferred and
   never encrypted. Claim-steal redelivery hits the same guard:
   a stolen newer claim still cannot encrypt before older owed
   writes on that peer.

`beforeItem` replaced `excludeEventId`. The current row is excluded
because it is not older than itself, so repeats of
`attemptPersistedSend` / `sendPersistedLinkJson` cannot drain
*newer* owed items ahead of their own retry.

## R3-F3: ordering metadata and lost-queue heal

`reconcilePaymentPendingSends` re-enqueues with `createdAt =
message.sentAt` (the original enqueue time), not `Date.now()`.
Startup/recover also scans owed outbound DM rows (`sending` /
`failed`) with no queue item and re-enqueues them with
`createdAt = sentAt` so they sort into the original sequence.

## R3-F4: persisted fingerprint on live retry-shaped paths

`attemptPersistedSend` and `sendPersistedLinkJson` look up the
queue row by `queueId` and pass **its** stored `secretFingerprint`
into reconstruction. They do not recompute from live KeyStore.
An attachment row without a stored fingerprint fails closed
(`validation`) and does not encrypt.

## R3-F5: live writers persist the fingerprint

`buildPreparedSendIntent` and the payment / lost-DM reconcile
enqueues thread `secretFingerprint` through `retryPayload`. The
"legacy payloads" waiver does not apply to these writers.

## R3-F7: pass-level try/catch

`reconcilePaymentPendingSends`, `reconcileLostOwedDeliveries`,
`listDeliveryQueue`, and `RetryQueue.getDue` sit in a pass-level
try/catch so one throw cannot abort the interval. The `void`
`drainRetries` / `recoverPendingSends` calls from the visibility
and interval timers `.catch` so rejections are not unhandled.

## R3-F8 (paykit `wasm_sleep`): waived

Not changed in this round; wasm pin stays rc50. If `setTimeout`
lookup/`call2` fails, the executor resolves immediately → every
drain races to an instant `Timeout` (fail-closed, total liveness
loss on that platform). Node's `setTimeout` returns an object so
`handle.as_f64()` is `None` and `WasmTimeoutGuard` is inert off
browser. Reason to skip: this is a Low optional; the shipped
surface is the browser wasm-bindgen build where `setTimeout`
returns a numeric id. A rc51 rebuild + re-vendor would expand
scope past the High/Medium close-out. Revisit if a Node-hosted
wasm write path ships.

## Reset encrypted link (Kimi Medium recommendation)

A permanently failing peer bricks later sends (parked retire
blocks the send-path drain; new rows keep accumulating). The
primitives already existed (`wipeLinkState` +
`PaykitLinkWeb.clearLinkOutbox`). This round adds:

- `LinkService.resetEncryptedLink(peer)` — wipe the link, drop
  that peer's queue items, **keep** conversation history. The next
  `ensureLink` / send starts a new handshake (new nonce sequence).
- `declineMessageRequest` now also drops that peer's queue items
  (it already wiped the link and deleted messages).

No UI is wired in this round. Decline / sign-out remain the
existing user-facing escapes; `resetEncryptedLink` is the
contained recovery primitive for a later settings action. A
full in-app "Reset encrypted link" confirmation flow (copy,
message-row fate, re-handshake UX) is deferred as product work.

## R4-F1 (Kimi round 4, blocking): park at the attempt cap, never remove

`RetryQueue.recordFailure` used to DELETE the queue row at the 10th
failure, contradicting the park invariant above: from the 10th failure
until the next `recoverPendingSends` (visibility/startup only — the 30s
interval drain does not heal), the still-owed row was invisible to every
drain including the send-path older-owed scan, so a new send could
encrypt at a possibly-ambiguously-committed nonce.

**Decision:** the attempt cap parks instead of removing
(`deferQueueItem(id, now + RETIRED_ITEM_PARK_MS)`, the same ~1 year
horizon `RetryQueue.park` uses). `getDue` keeps skipping the parked item;
`listDeliveryQueue` (the send-path drain) keeps seeing it and keeps
blocking newer same-peer encrypts; the `true` return still triggers
`markFailed` so the row surfaces as failed. Because the queue row
survives, `hasQueueItemForMessage` stays true and the lost-item heal can
no longer resurrect a capped item with `attempts: 0` (the R4-F3
cap-defeating loop). Group fan-out items were dropped by the same removal
path, so parking preserves them too (the fan-out half of R4-F5).

## R4-F2 (Kimi round 4): pre-encrypt re-scan + heal enqueues under the peer mutex

`deliverQueuedPayloadLocked` ran the older-owed scan at entry, but the
encrypt happens after `ensureLinkLocked` — a network-scale handshake
window — and heal enqueues ran under `withDrainPass` only, so an older
owed item could be inserted mid-delivery and encrypt out of order.

**Decision:** two layers.

1. Every encrypt path re-runs `drainOwedSamePeerWritesLocked` immediately
   before the encrypt. `deliverQueuedPayloadLocked` re-scans after
   `ensureLinkLocked` returns `ready` and self-defers when the re-scan is
   not clear. `attemptPersistedSend`, `sendPersistedLinkJson`, and
   `dispatchPreparedDm` — whose scan→encrypt windows are only
   microtask/attachment-reconstruction scale because `ensureLinkLocked`
   runs before their entry scan — re-scan right before
   `sendPrivateMessageJson` anyway: the re-scan is one SELECT and does
   not re-acquire `withQueue(peer)`, so there is no deadlock and no
   reason to waive the window.
2. The two heal enqueues (`reconcilePaymentPendingSends`,
   `reconcileLostOwedDeliveries`) run their `hasQueueItemForMessage`
   check + `StorageService.enqueue` inside `withQueue(peer)`, so a heal
   insertion is ordered against in-flight deliveries for that peer.
   Heals are the only writers of backdated (`createdAt = sentAt`) queue
   items; live send intents always use `Date.now()` and can never be
   older than an in-flight item.

## R4-F4 (Kimi round 4): reset means "stop trying"

**Decision:** `resetEncryptedLink` marks the peer's owed outbound DM rows
terminally `failed` instead of letting the heal re-send owed history
under the new link. No schema change.

`pending_cleanup` cannot express this: it is the KeyStore/cache cleanup
journal (`target_kind` `keystore` | `cache`), not a message-state table.
The contract's `LinkDeliveryState` has no `abandoned` value, and adding
one would edit pinned `src/types/link.ts`. Mobile's v14/v15 are
handshake-budget columns (`pending_advances` / `link_handshake_budgets`)
— unrelated, and web is pinned at v13 (`6185a6a`), so a web-only v14
`abandoned_at` would also break `check:wire` and collide with mobile's
already-shipped v14.

The existing `failed` state is enough. After R4-F1, a cap-failed row
keeps its parked queue item (`hasQueueItemForMessage` stays true), so
healing `failed` was only the R4-F3 resurrection loop plus the reset
re-send. `listOwedOutboundLinkMessages` therefore selects only
`sending`. `abandonOwedLinkMessagesForPeer` flips the reset peer's
in-flight rows to `failed`. Crash-loss of a parked failed queue item
stays in the waived tail-loss class.

This was chosen over documenting re-send-on-heal because silently
delivering months-old failed messages after a "reset" is the surprising
behavior; terminal failure is inspectable and inert. No UI is built for
this; the rows simply render as failed.

Group fan-out: `removeQueueItemsForRecipient` deletes the peer's fan-out
queue items, which previously orphaned `group_messages` rows in `sending`
forever (there is no group heal). Reset (and decline, which shares the
queue-drop) now snapshots the peer's fan-out payloads before the delete
and marks each affected group message failed when no other recipient's
queue item remains owed (`markFailed` re-counts, so a message still owed
to another recipient is left for that recipient's delivery to settle).

## R4-F5 (Kimi round 4): heal scope note

The lost-item heal (`reconcileLostOwedDeliveries` over
`listOwedOutboundLinkMessages`) covers outbound DM rows only. Group
fan-out deliveries rely on park persistence: with R4-F1 parking at the
attempt cap (and the existing age-based park), a fan-out queue item is
never removed while its write is still owed, so no fan-out heal is
required. If a fan-out queue item were ever lost by a new code path, its
`group_messages` row would sit in `sending` with no re-enqueue — any
future queue-item deleter must settle fan-out rows the way reset does.

## R4-F6 (Kimi round 4): `buildPreparedSendIntent` is async

Confirmed. The only in-repo caller is the unit test, which `await`s it.
Payment reconcile does not call it — it builds the queue payload inline
from the persisted `link_messages` row. Full-repo `tsc --noEmit` is the
gate that any out-of-bundle payment caller would fail if it dropped the
`await`.
