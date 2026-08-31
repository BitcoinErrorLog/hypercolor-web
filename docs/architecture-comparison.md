# Architecture comparison: Hypercolor, Signal, Keet/Pear

This note compares Hypercolor’s messaging design to Signal and Keet (Holepunch /
Pear) on identity, authority, async delivery, portability, censorship
resistance, metadata, and history. Hypercolor claims are pinned to this repo.
Signal and Keet claims follow their published designs. Hypercolor is not
stronger on every axis.

## How Hypercolor addresses a conversation

A 1:1 thread is the pair of Pubky identities plus Paykit receiver paths and
Noise keys — never a homeserver URL.

- Receiver path is `hypercolor/wallet` (`LINK_RECEIVER_PATH` in
  `src/types/link.ts`).
- Encrypted Link restore/send uses `peerPubky`, `localReceiverPath`,
  `remoteReceiverPath`, and the peer Noise public key
  (`PaykitLinkWeb.initiateLink` / `restoreLink` in
  `src/services/link/PaykitLinkWeb.ts`).
- `contact.homeserver` is stored and scored (`TrustEngine.explain`,
  `src/services/TrustEngine.ts`) but is not a fetch argument. Lookups go
  through a bare `new wasm.PubkyClient()` (`getPaykitClient` in
  `PaykitLinkWeb.ts`).

Signup on a homeserver publishes `_pubky` pointing at that host
(`PubkySigner::signup` in pubky-sdk `actors/signer/session.rs`). Changing
host is “signup again with the same secret on a new homeserver,” which
force-publishes a new `_pubky` record.

## Comparison

### Identity binding

| System | Binding |
| --- | --- |
| **Hypercolor** | Ed25519 Pubky. The account *is* the key. Production sign-in is Ring + pubkyauth (`PaykitLinkWeb.startAuthFlow`); harness sign-up is `signupWithSecret`. There is no phone number, email, or recovery service. Key loss is unrecoverable. |
| **Signal** | Phone number for discovery and account creation, plus a UUID ACI and identity keys. Phone hashing / CDS reduced some leakage but the account is still issued and recoverable through Signal’s service. Losing the device is recoverable; losing the number is an account-recovery problem Signal owns. |
| **Keet / Pear** | Cryptographic keypair (Hyperswarm / Hypercore). Identity is the key, similar to Pubky. No provider-issued account. Key loss is also unrecoverable. |

Hypercolor matches Keet on “identity is a key” and is stricter than Signal:
there is no provider-side recovery. That is a feature for seizure resistance
and a liability for ordinary users.

### Authority dependencies

| System | Who must stay up |
| --- | --- |
| **Hypercolor** | A homeserver must accept writes for the sender’s outbox / owner tree. Pkarr relays (and/or DHT) must resolve `_pubky`. WASM cannot speak Pubky TLS; it rewrites to an ICANN HTTP host or `localhost` + `HTTP_PORT` (`pubky-sdk` `client/http_targets/wasm.rs`). Onboarding also needs the HTTP relay (`src/lib/http-relay.ts`). Nexus is used only for the public social graph (`NexusClient.ts`). |
| **Signal** | Signal’s servers are the only mailbox. Clients do not run a replaceable store. Sealed sender and CDS still terminate on Signal infrastructure. |
| **Keet / Pear** | No mailbox operator. Delivery is Hyperswarm + holepunch. Bootstrap / DHT nodes are a weaker authority: they help peers find each other but do not store the chat. An always-on “blind” peer is optional, not the default product. |

Hypercolor’s homeserver is replaceable *in protocol*. It is still required
*in practice* for async delivery. That is the opposite of Keet (no mailbox)
and weaker than Signal only in the sense that you can change operators — not
that you can go without one.

### Offline / asynchronous delivery

| System | Offline peer |
| --- | --- |
| **Hypercolor** | Yes, if the sender can write an Encrypted Link packet to a homeserver outbox (`src/types/link.ts`: “Noise XX over pubky homeserver outboxes”) and the receiver later fetches it via pkarr. |
| **Signal** | Yes. Store-and-forward on Signal servers is the product. |
| **Keet / Pear** | Weak. Both sides (or a designated always-on device) must be reachable over the swarm. There is no first-class mailbox. Offline message durability is a local/P2P problem, not a hosted inbox. |

Hypercolor and Signal are async-first. Keet is online-first. Anyone selling
Hypercolor as “more available than Signal” is wrong; it is more available
than Keet and more operator-diverse than Signal.

### Account portability

| System | Move the account |
| --- | --- |
| **Hypercolor** | Intended: republish `_pubky` to a new homeserver (`signup` force-publishes; `Pkdns::build_homeserver_packet`). Same pubky, same Noise receiver secret (`provisionReceiver` reuses `KeyStore` material). Peers are not supposed to learn a new address. |
| **Signal** | No. The account lives on Signal. You can change phones, not operators. |
| **Keet / Pear** | There is no account host to move. The key *is* the account. |

Portability is Hypercolor’s distinctive claim versus Signal. It is not free:

- User `_pubky` HTTPS records are published with TTL **3600s**
  (`pubky-sdk` `actors/pkdns.rs`, `build_homeserver_packet`).
- Homeserver packets use the same **3600s** TTL
  (`pubky-homeserver` `republishers/key_republisher.rs` `create_signed_packet`).
- The pkarr client caches resolved packets with
  `DEFAULT_MINIMUM_TTL = 300` and `DEFAULT_MAXIMUM_TTL = 86400`
  (`pkarr` `src/lib.rs`). A 3600s record is therefore cached for **one hour**
  on a peer that already resolved you (`PubkyClient` is a process singleton
  in `getPaykitClient`).
- WASM peers will keep talking to the *old* ICANN/localhost mapping until
  that cache expires. If the old host is gone, the conversation is stuck
  until then.

So portability is real in the data model and delayed in the lookup cache.
The live proof in `e2e/migration-staging.spec.ts` measures that delay
instead of assuming it is instant.

### Censorship resistance

| System | What a provider can do |
| --- | --- |
| **Hypercolor** | A homeserver admin can disable a user (`POST /users/{pubkey}/disable`, `disable_users.rs`) and delete files (`DELETE /webdav/{path}`, `delete_entry.rs`). Disable blocks **writes** (`tenants/write.rs` `err_if_disabled: true`) but **public GET still serves existing files** (`tenants/read.rs` `get` does not check `disabled`). A banned user can signup elsewhere and republish `_pubky`. A peer with a stale pkarr cache still aims at the banned host. |
| **Signal** | Signal can disable an account, and a national network can block Signal’s IPs/domains. Users cannot move the mailbox. Domain fronting / TLS proxies are mitigations Signal has used; they are still Signal-operated. |
| **Keet / Pear** | No operator to ban a user. A network can block bootstrap or DHT, or attack holepunch. There is no “delete this person’s mailbox” button. |

Hypercolor’s claim — “keep talking after a ban because the homeserver is a
replaceable mailbox” — is **conditionally true**:

- True in addressing: peers keep the same pubky.
- True only after pkarr cache/TTL, if the old host no longer serves you.
- False for data that lived only on the banned host and was deleted.

That is better than Signal (no move) and worse than Keet (no host to ban)
on the “someone pressed delete” axis.

### Metadata exposure

| System | What a third party sees |
| --- | --- |
| **Hypercolor** | Homeserver operators see authenticated writer identity, paths (`/pub/paykit.app/…`, `/pub/hypercolor.app/v1/…`), sizes, and timing. Encrypted Link payloads are ciphertext. Attachment ciphertext is world-readable at `pubky://{sender}/pub/hypercolor.app/v1/attachments/{uuid}` (`buildAttachmentLocation` in `src/types/attachment.ts`); the key travels only on the link. Public channel messages are plaintext on each author’s homeserver (`src/types/group.ts`). Nexus sees follow-graph queries, not messages. Pkarr relays see `_pubky` publish/resolve. HTTP relay sees pubkyauth channel traffic during onboarding. |
| **Signal** | Sealed sender hides the sender from the server on supported paths; the server still learns the recipient, approximate time, and that a message existed. CDS / SGX reduced contact-discovery leakage. Signal the company still operates the only mailbox. |
| **Keet / Pear** | No hosted mailbox metadata. Swarm topics and DHT lookups can leak that two keys are trying to meet. Traffic between punched peers is visible to the path, not to a chat operator. |

Hypercolor leaks more *structural* metadata than Signal sealed sender
(paths, public attachment blobs, public channels) and more *operator*
metadata than Keet (a homeserver exists). It leaks less *social-graph
content* than a typical centralized chat because DMs are not handed to
Nexus.

### History durability

| System | Where history lives |
| --- | --- |
| **Hypercolor** | Device-local SQLite (`link_messages` via `StorageService`). Encrypted Link packets on homeserver outboxes. Attachment ciphertext on the **sender’s** homeserver (`types/attachment.ts`). Public channel messages on **each author’s** homeserver (`types/group.ts` around the public-channel path comment). Private group messages are pairwise PAMs on 1:1 links (`types/group.ts` “pairwise fan-out”); they inherit Encrypted Link durability, not a shared group log. |
| **Signal** | Local client store. Optional encrypted backup. Server is not a long-term archive of plaintext. Disappearing messages are a first-class control. |
| **Keet / Pear** | Local / Hypercore. No provider archive. If both devices are gone, the history is gone. |

Hypercolor is **weaker than Signal** on history durability: wiping a
homeserver deletes sender outboxes, attachment blobs, and that author’s
public-channel posts. A peer that already synced keeps a local copy;
a new device cannot reconstruct what the banned host deleted. Hypercolor
is also weaker than a well-replicated Keet core if you assumed “the
network stores it.” It does not.

Key loss is unrecoverable in Hypercolor and Keet. Signal can re-provision
an account around a phone number (with trust in Signal).

## Remaining centralisation / authority in this repo

Messaging path means Encrypted Link send/receive or owner-tree GET/PUT
after the user is already enrolled. Onboarding / discovery means auth,
social graph, or lookup infrastructure.

| Dependency | Where | Path? |
| --- | --- | --- |
| Homeserver of the *sender* (outbox / owner PUT) | Session from `signupWithSecret` / `startAuthFlow`; writes via `SessionHandle.putPublic` | **Messaging** |
| Homeserver of the *peer* (public GET of marker, attachments, public posts) | `PaykitLinkWeb.publicGet` / `getReceiverMarker` | **Messaging** |
| Pkarr relays `https://relay.pkarr.org`, `https://pkarr.pubky.org` (and homeserver config also lists `https://pkarr.pubky.app`) | Default `pkarr::DEFAULT_RELAYS`; WASM `PubkyClient` has no custom relay list (`PaykitLinkWeb.getPaykitClient`) | **Messaging** (every resolve) |
| Pkarr record TTL 3600s + client cache min 300s / max 86400s | `pkdns.rs` `build_homeserver_packet`; `key_republisher.rs` `create_signed_packet`; `pkarr` `DEFAULT_MINIMUM_TTL` / `DEFAULT_MAXIMUM_TTL` | **Messaging** (stale host) |
| WASM ICANN / localhost rewrite | `pubky-sdk` `client/http_targets/wasm.rs` `apply_endpoint_to_url` | **Messaging** (browser cannot do Pubky TLS) |
| HTTP relay `https://httprelay.pubky.app/link` | `src/lib/http-relay.ts` `DEFAULT_HTTP_RELAY`; `src/services/relayChannel.ts` | **Onboarding only** (Ring / pubkyauth channel) |
| App origin `https://hypercolor.app` | `src/lib/app-origin.ts` `DEFAULT_APP_ORIGIN` (Ring callback URL) | **Onboarding only** |
| Nexus `https://nexus.pubky.app` | `src/flags/config.ts` `PRODUCTION_NEXUS_BASE_URL`; `src/services/NexusClient.ts` | **Discovery only** (followers / friends / public profile). Comments forbid using it for messages. |
| Staging homeserver `ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy` | `src/services/link/ownerRoundtrip.ts` `STAGING_HOMESERVER_Z32`; used by `stagingSignup.ts`, `dmHarness.ts`, `migrationHarness.ts` | **Harness / onboarding-to-staging only**, not production fetch |
| Staging admin `https://admin.homeserver.staging.pubky.app` | `e2e/migration-staging.spec.ts` (ban proof) | **Proof only** |

`TrustEngine` treating a stored `contact.homeserver` as +0.1 trust
(`src/services/TrustEngine.ts`) is a UX signal, not a control-plane
dependency.

## Empirical proof (this worktree)

Live run: `npm run proof:staging:migration` against staging
(`STAGING_HOMESERVER_Z32` in `src/services/link/ownerRoundtrip.ts`) plus a
local `pubky-homeserver` advertising `localhost:6286` and published to
`pkarr.pubky.org` / `relay.pkarr.org`.

**Result: the migrate step failed. The conversation never reached
post-migrate send.** Assertions were not loosened.

### Graceful migrate

1. A and B signed up on staging, completed Encrypted Link, exchanged DMs
   (the test reached `runMigrationTo`).
2. Local `/signup` returned HTTP 200 — the local homeserver created A
   (`pubky-homeserver` `client_server/routes/auth.rs` `signup`, after
   `UserRepository::create` and `create_session_and_cookie`).
3. The WASM client then failed inside `PubkySigner::signup` →
   `publish_signup_homeserver` → `Pkdns::publish_homeserver_force`
   (`pubky-sdk` `actors/signer/session.rs`).
4. Exact error from `runMigrationTo`
   (`src/services/link/migrationHarness.ts`):

   `Pkarr operation failed: Failed to publish record to the DHT: Compare and swap failed; there is a more recent SignedPacket than the one seen before publishing`

   That string is `pkarr::errors::ConcurrencyError::CasFailed`
   (`pkarr` `src/client.rs`).

5. `Pkdns::publish_with_retries` (`pkdns.rs`) retries `Publish` errors
   (`PkarrError::is_retryable` is true for `Publish(_)`) but **reuses the
   first `resolve_most_recent` timestamp**. A CAS failure therefore
   repeats two more times and then surfaces. There is no browser API to
   re-resolve and publish (`paykit-wasm` `PubkyClient` exposes
   `signupWithSecret` / `signinWithSecret`, not `publishHomeserver`).
6. Because `signup` creates the user **before** publishing `_pubky`, a
   retry of `signupWithSecret` cannot recover: the local host now returns
   `409 User already exists` (`auth.rs`). The JS caller never received a
   `SessionHandle`. A remains on the staging session. `_pubky` still
   names the staging host.

So “signup again on a new homeserver” — the only migrate path this
browser build has — does **not** republish identity. Peers keep resolving
A to the old mailbox.

### Ban then migrate

Reproduced with `--workers=1` (not a parallel-worker flake). After
staging disable/delete, `runMigrationTo` failed with
`Request failed: HTTP transport error: error sending request`
(`pubky-sdk` `errors.rs` `Error::Request`). The local admin minted a
token; **no** `OPTIONS`/`POST /signup` reached `127.0.0.1:6286`. The
WASM client never opened the migrate HTTP hop.

A plausible cause is `PubkyHttpClient::select_first_usable_endpoint`
(`pubky-sdk` `client/http_targets/wasm.rs`): it returns the first SVCB
with a domain, not the browser-usable `localhost` + `HTTP_PORT` record.
The homeserver packet advertises Pubky TLS on `:6287` *and* localhost
HTTP on `:6286` (`key_republisher.rs` `create_signed_packet`). A browser
that picks the TLS record cannot complete `fetch` (no Pubky TLS in
WASM). The graceful test’s `/signup` *did* hit `:6286` (HTTP 200) and
then died on CAS — so localhost routing can work, but it is not
reliable.

Disable/delete on staging ran in the Node runner before migrate. Ban
survival (history, attachments, Noise) was not measured because migrate
threw.

### What this does and does not falsify

- **Falsified (this client, this API):** a user who already published
  `_pubky` cannot switch homeservers via `signupWithSecret`. The
  replaceable-mailbox slogan depends on a pkarr update that CAS-rejects.
- **Not measured:** post-migrate B→A / A→B delay, Noise restore after
  `releaseLiveHandlesForHarness`, attachment 404 after staging DELETE,
  or whether B’s local SQLite still has pre-ban bodies after a *successful*
  migrate. Those assertions never ran.
- **Still true in the data model:** conversations are keyed by pubky +
  receiver path + Noise key, not by a homeserver URL. That addressing
  did not get a chance to matter.

Propagation delay: **not measured** (republish never succeeded). The
cache/TTL numbers in the portability section remain the *upper bound
if* republish worked.

## What this comparison does not claim

- Hypercolor is not “decentralized Signal.” Async delivery still needs a
  mailbox operator, pkarr relays, and (in browsers) an ICANN HTTP name or
  localhost mapping.
- Hypercolor is not “Keet with history.” Keet’s availability model is
  online/P2P; Hypercolor’s history is split across local SQLite and
  per-author homeservers and dies with a wipe.
- The censorship-resistance slogan is a **protocol** property (identity ≠
  host) plus a **cache** property (up to one hour on a live peer) plus a
  **durability** hole (deleted host data is gone). The live proofs exist
  to measure those last two instead of repeating the slogan.
