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

Not claimed: a *new* message sent while a prior `put` reported
failure but the homeserver actually stored the first ciphertext
(same nonce, different plaintext) is a pubky-noise slot-overwrite
question, not a snapshot-rollback one. Per-peer `withQueue` plus
retry-of-same-`wireJson` is what the web path does. No persist-
before-write journal was added because the rollback + different-
plaintext path is not reachable on this stack.
