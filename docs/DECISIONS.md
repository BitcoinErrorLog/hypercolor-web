# Decisions and audit waivers

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
