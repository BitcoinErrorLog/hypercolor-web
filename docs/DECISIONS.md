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
