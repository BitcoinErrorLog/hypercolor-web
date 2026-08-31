# ADR 0001: Group as a Pubky — Private Messaging Only

## Status

Proposed — 2026-08-31

Amended 2026-08-31 in the chat-architecture synthesis. This ADR is scoped to **private** DMs and **private** groups. Public channels and rooms are [ADR 0002](0002-public-chat-as-graph.md). The merged execution order is [ADR 0003](0003-chat-architecture-roadmap.md).

This is a design decision, not an implementation. No protocol change ships until a later ADR or plan marks the work Accepted and names the wire revision.

Supporting analysis: [graph-utilisation-review.md](../graph-utilisation-review.md).

## Scope — two domains, one graph, one privacy boundary

Hypercolor sits on two domains that share Pubky primitives and must not be collapsed:

| Domain | What it is | Where it lives | Who can see it |
|---|---|---|---|
| **Public channels / rooms** | A UX view over the existing social graph | `PubkyAppPost` + `PubkyAppTag` + `PubkyAppFeed` under `/pub/pubky.app/` | World. Nexus indexes it. That is the product. |
| **Private DMs and groups** | Encrypted messaging | Encrypted Link PAMs today; group-as-pubky + per-member prefixes + signed DAG for new private groups | Ciphertext may sit on world-readable `/pub`. Plaintext must not. Nexus must not index it. |

The boundary between those rows is the **privacy boundary**. It is a product fact, not an accident of which path prefix we picked. A design that maximises graph power by publishing DM or private-group facts into `/pub/pubky.app/` (follows-as-roster, membership-as-tag, private bodies as posts) deanonymises the messenger. That is a bad design.

This ADR owns the **private** row. ADR 0002 owns the public row.

## Namespace ownership (the conflict this amendment resolves)

The first draft of this ADR applied group-as-pubky to *public* channels as well (original Phase 3: plaintext DAG on a group tenant). The graph review showed why that fails: `Resource` in `pubky-app-specs/src/uri/resource.rs` has `User`, `Post`, `Follow`, `Mute`, `Bookmark`, `Tag`, `File`, `Blob`, `Feed`, marketplace variants, and `Unknown` as `#[default]`. There is no Hypercolor variant. Nexus watcher PUT handling matches `PubkyAppObject` variants and otherwise logs `"Event type not handled"` (`pubky-nexus/nexus-watcher/src/events/mod.rs` `handle_put` / `other => debug!(...)`). A public message that is not a post is dropped as `Unknown`.

That is the same self-inflicted invisibility `/pub/hypercolor.app/v1/public-channels/` already has. The web client does not even implement that schema: `GroupService` states “Public channels are out of scope on web” and throws `private-only` (`src/services/group/GroupService.ts`).

**Decision:**

| Namespace | Domain | Indexed by Nexus? |
|---|---|---|
| `/pub/pubky.app/posts/`, `/tags/`, `/feeds/`, `/files/`, `/blobs/`, `/follows/`, `profile.json` | Public graph (ADR 0002) | Yes, when the object is a known `Resource` |
| `/pub/pubky.app/mutes/` | Public mute list | Watcher no longer applies mute PUTs (`events/mod.rs` `PubkyAppObject::Mute` → `"Mute events are no longer handled by nexus"`) |
| `/pub/paykit/` | Encrypted Link transport (`PAYKIT_MESSAGING_CAPABILITY`) | No |
| `/pub/hypercolor.app/v1/group/` | **Private** group tenant (this ADR) | No. Invisible **by design**. |
| `/pub/hypercolor.app/v1/attachments/` | Private attachment ciphertext v0 (`ATTACHMENTS_PATH_PREFIX` in `src/types/attachment.ts`) | No. Keep until attachment v1. |
| `/pub/hypercolor.app/v1/backup/latest` | Owner backup (`BACKUP_PATH` in `src/services/backup/homeserver.ts`) | No. App-private state. Keep. |
| `/pub/hypercolor.app/v1/public-channels/` | **Dropped** | Would be `Resource::Unknown`. Do not implement on web. |
| `chat.public.message.v0` | **Dropped** as a product schema | Same. Decode may remain for any historical objects (open question: mobile). |

Group-as-pubky therefore does **not** host public utterances. If a public community later wants a group key as an *operator* (pins, re-seeding media), that host must still emit member utterances as ordinary posts tagged with the room label (ADR 0002). Putting public messages only in `/pub/hypercolor.app/v1/group/` is rejected.

Writes outside `/pub/` are forbidden (`pubky-homeserver/src/client_server/layers/authz.rs` `authorize`: any path that is not `/session`, `/pub/…`, or `/dav/…` returns `"Writing to directories other than '/pub/' is forbidden"`). Private group data is therefore encrypted **inside** world-readable space. There is no `/priv` mailbox.

## Context

### What is already true for users (re-verified on this tree, `origin/main` `93f0ea1`)

Conversations are addressed by peer pubky + receiver path + Noise public key, never by a homeserver URL. `PaykitLinkWeb.initiateLink` takes `peerPubky`, `peerNoisePublicKey`, `localReceiverPath`, and `remoteReceiverPath` (`src/services/link/PaykitLinkWeb.ts` `initiateLink`). `LinkService.initiateHandshake` fills those from the peer's receiver marker and `LINK_RECEIVER_PATH` (`src/services/link/LinkService.ts` `initiateHandshake`). `getReceiverMarker(peerPubky, receiverPath)` and `publicGet(ownerPubky, path)` take a pubky and a path. The client is a bare `new wasm.PubkyClient()`; peer lookup goes through pkarr, not a stored host URL.

`contact.homeserver` is persisted (`src/types/index.ts` `Contact.homeserver`, `src/db/schema.ts` contacts `homeserver` column, `StorageService.upsertContact`) and the account homeserver is shown on Settings. It is not an input to any fetch. The only product use of `contact.homeserver` is a +0.1 trust signal when the field is non-empty (`src/services/TrustEngine.ts` `explain`, `homeserverScore`).

Ring already grants this app scoped write over the *user* key. Enable Messaging requests `RING_GRANT_CAPABILITIES` = `/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw` (`src/types/link.ts` `PAYKIT_MESSAGING_CAPABILITY`, `HYPERCOLOR_WRITE_CAPABILITY`, `RING_GRANT_CAPABILITIES`; `LinkService.enable` / `startAuthFlow`). That grant does **not** include `/pub/pubky.app/`. That is why public chat was invented under the Hypercolor prefix, and why composing posts requires a *separate* grant (ADR 0002). The group-membership primitive this ADR reuses is the same capability exchange, issued by a **group** key onto the **group** tenant.

### Where the user pattern was not applied (private side)

**Private groups.** There is no shared group key and no group homeserver space (`src/types/group.ts` header: “There is NO shared group key”; `GroupService` is pairwise Encrypted Link fan-out). A private group message is a Private Application Message over each member's existing 1:1 Encrypted Link. Delivery of *unreceived* messages still depends on the sender's Paykit outbox (the sender's homeserver). Recipients who already decrypted a PAM keep it locally. Removal is receive-side policy: “Pairwise fan-out has NO cryptographic removal cutoff” (`src/types/group.ts`; `GroupService.removeMember`). `channel_id` is founder-bound `{founderPubky}:{uuid}`.

**Private DMs.** Encrypted Link payloads are `chat.message.v0` with decode compatibility for `pubky_app.dm.v0` (`src/types/link.ts` `CHAT_MESSAGE_KIND`, `PUBKY_APP_DM_KIND`). They never become posts. They must not.

**Attachments.** Ciphertext is world-readable at a sender-owned path `pubky://{owner}/pub/hypercolor.app/v1/attachments/{uuid}` (`src/types/attachment.ts` `buildAttachmentLocation`, `ATTACHMENTS_PATH_PREFIX`). The access PAM (`chat.attachment.v0`) carries key/nonce over the Encrypted Link. AEAD AAD **must equal** `location`, so the ciphertext is bound to that exact sender URL. A sender ban 404s the file. Plaintext cap is 8 MiB (`src/flags/config.ts` `ATTACHMENT_MAX_BYTES`); thumbnails 256 KiB.

**Indexing.** `NexusClient` is “a PUBLIC social-graph aggregator” for followers / following / friends / public profile — never messages (`src/services/NexusClient.ts`). Default host is `https://nexus.pubky.app` (`src/flags/config.ts` `PRODUCTION_NEXUS_BASE_URL`). On this web tree the only live call site is `addManualContact` fetching `nexus.user` for a display name (`src/services/contacts/addManualContact.ts`). `NexusClient.followers` / `.following` / `.friends` and `StorageService.setContactRelationshipFlags` have no production callers. `Contact.isFollower` is documented as “They follow me (Nexus followers)” (`src/types/index.ts`). The client already ships SQLite via official `sqlite3.wasm` (`src/db/openWebSqlite.ts`, `src/db/index.ts` `getDb`).

**Follows are not a roster.** `/pub/pubky.app/follows/:user_id` is a world-readable `PubkyAppFollow { created_at }` (`pubky-app-specs/src/models/follow.rs`). A follows-derived contact list is a public contact list. Import is **opt-in and read-only** (ADR 0002 / ADR 0003 item 1). This ADR’s local index must not ingest that directory into a mandatory Hypercolor roster on Enable Messaging. Signal’s list is not world-readable; this path is.

### The multi-writer primitive (verified)

`pubky_common::capabilities::Capability` is `{ scope, actions }` (`pubky-core/pubky-common/src/capabilities.rs`). Scope is a path prefix that must start with `/`. Actions are `r` (GET) and `w` (PUT/POST/DELETE). Module docs: `w` => write (PUT/POST/DELETE). `Action::Write` is documented as “Can write to the scope at the specified path (PUT/POST/DELETE requests).” There is no append-only variant.

`pubky_common::auth::AuthToken` binds `public_key` as “the owner of the resources being accessed” (`pubky-common/src/auth.rs`). Version 0: the signer *is* that owner; there is no delegation. An unauthorized third-party PUT to an owner's path returns 401 (`pubky-core/e2e/src/tests/storage.rs` `unauthorized_put_delete`).

Homeserver write authorization checks that the session cookie's `user_pubkey` matches the request's pubky-host **and** that some capability has `Action::Write` whose `scope` is a prefix of the path (`authz.rs` `authorize`). GET/HEAD under `/pub/` is world-readable without a session.

Directory listing exists: a GET whose path `is_directory()` lists (`pubky-homeserver/src/client_server/routes/tenants/read.rs` `get` → `list`).

A group keypair can therefore sign up on a homeserver, publish a pkarr record, and issue scoped AuthTokens the same way a user issues Ring grants. That part **is** possible with current primitives. What is *not* possible is listed under Decision §2.

## Decision

Apply the user-identity pattern to **private groups**, private attachments, and the local index of *private* state.

1. A **private group is a first-class pubky**: its own ed25519 keypair, pkarr record, and homeserver space. Group history inherits mailbox migration and operator-ban resistance by the same mechanism users already have.
2. **Membership write access** is a scoped capability issued by the group key, delivered over an existing Encrypted Link, exchanged for a homeserver session on the *group* identity. Paths are **per-member prefixes**, not a shared write root (see §2 — this is required, not stylistic).
3. **Messages are a content-addressed, author-signed DAG.** Hosting is fungible. Any member may serve any message; the recipient verifies signature and hash independently of the server. Private bodies on that DAG are encrypted (Hard parts).
4. **Attachments are content-addressed and re-seedable.** AAD binds to the content identity, not to a sender homeserver URL. A ban costs availability until a replica appears.
5. **Forkability** is the answer to admin capture. Members re-anchor on a hash and continue under a new group key. We do not try to design admin abuse out of existence.
6. **The local SQLite index is source of truth** for the user’s own *private* graph (contacts they added, links they opened, group rows they decrypted). Any indexer (Nexus today, nexus-scout, others later) is an untrusted accelerator of the *public* graph only. A hostile or absent indexer degrades public discovery speed, not private correctness.

1:1 DMs stay Encrypted Link PAMs. This ADR does not move DMs onto a group tenant.

### 1. Group as a first-class pubky

#### Identity

A group is an ed25519 keypair. The public key (`groupPubky`) is the stable name. The secret is the group's root. Whoever can sign with that secret can (a) republish the group's pkarr record, (b) issue and re-issue member sessions, (c) sign the group manifest. That is a soft authority. Forkability (§5) constrains it; it is not eliminated.

Signup is the same as a user: `AuthToken` signed by the group key, presented to a homeserver (`pubky-homeserver` `signup` / `signin` in `client_server/routes/auth.rs`). On `token_required` homeservers this consumes a signup token. Operationally a group is another tenant.

#### Discovery

Clients never store a homeserver URL for the group. They resolve `groupPubky` via pkarr, then read:

| Resource | Path | Who writes |
|---|---|---|
| Manifest | `/pub/hypercolor.app/v1/group/manifest.json` | Group key (root session) |
| Heads hint | `/pub/hypercolor.app/v1/group/heads.json` | Group key |
| Member log prefix | `/pub/hypercolor.app/v1/group/members/{memberPubky}/` | That member's scoped session |
| Blob prefix | `/pub/hypercolor.app/v1/group/blobs/{sha256}/` | Any member with blob write, or the group key |

These paths are **private-group** objects. They are world-readable as ciphertext (or as a sealed envelope). They are not posts. Nexus must not be taught to index them.

Invite link:

```
hypercolor://join-group?group={groupPubky}&head={rootOrTipHash}&name={url-encoded}
```

`group` is mandatory. `head` is the content hash the invitee must be able to verify before treating the manifest as the same group the inviter meant. Private-group invites still require an Encrypted Link to the inviter (WoT / pairwise auth does not move onto the group key).

Do **not** use this invite as the primary public-room join path. Public rooms use a tag or a feed URI (ADR 0002). `hypercolor://join-public?channel=` is not the successor for public chat.

#### Group manifest

Canonical JSON, signed by the group key. Readers reject an unsigned or wrongly-signed manifest.

```
{
  "version": 1,
  "kind": "hypercolor.group.manifest.v1",
  "group_pubky": "<z-base32 ed25519>",
  "name": "<string>",
  "created_at": <unix-ms>,
  "visibility": "private",
  "membership_epoch": <u64>,
  "members": [
    {
      "pubky": "<member>",
      "role": "admin" | "member",
      "added_at": <unix-ms>,
      "status": "active" | "removed",
      "removed_at": <unix-ms | null>
    }
  ],
  "log_root": "<sha256 of the first membership-create event>",
  "heads": ["<sha256>", "..."],
  "blob_hints": ["<sha256>", "..."],
  "predecessor_group": "<groupPubky | null>",
  "predecessor_head": "<sha256 | null>"
}
```

`visibility` is `"private"` for every group this ADR creates. A `"public"` visibility that stored plaintext bodies on the group tenant is how the original draft would have reproduced `Resource::Unknown`. Public rooms are not this object.

`predecessor_*` is how a fork or a re-created group points at the history it claims. `heads` on the manifest is an **advertisement**, not a consensus vote. Authoritative heads are the union of per-member `heads.json` files under each active member prefix, verified against the DAG.

The manifest is not the membership capability. A removed member listed `removed` in the manifest is ignored by compliant readers even if they still hold a write session (§2).

The members array is written on `/pub`. Anyone who can GET the group tenant can see *that* those pubkys are (or were) members, unless the manifest itself is encrypted to the epoch key. **Requirement:** encrypt the stored manifest (and member-prefix objects) to the current membership-epoch key, or store only ciphertext blobs whose plaintext is distributed over Encrypted Links. A plaintext member roster on `/pub` is a public roster. Do not ship that.

#### Homeserver migration

Identical to a user moving mailbox:

1. Group key holder signs up (or already has an account) on the destination homeserver.
2. Copy `/pub/hypercolor.app/v1/group/` from old host to new (members can help; objects are content-addressed and signed).
3. Republish the group's pkarr record to the new homeserver public key.
4. Clients resolve pkarr on the next read; they do not have a stale host to unlearn.

If the key holder refuses or the secret is lost, clients do **not** wait. They fork (§5).

Custody of the group secret is the weakest point on web: this runtime has no OS keychain (`SECURITY.md`). Production identity secrets stay in Ring; `signinWithSecret` is e2e-only. A group secret held in JS is the same class of risk as a web-held user secret. **Recommendation:** the founder issues the group from Ring (or another authenticator that can hold a second keypair) and treats web as a session holder, not the root. Whether Ring can hold a non-user group keypair is an Open Question.

### 2. Capability-scoped membership — and what Pubky cannot do

#### What works

The group key signs an `AuthToken` whose capabilities are path prefixes on the **group** identity, then encrypts that token to the member over the existing Encrypted Link (Noise XX, already the private-group transport). The member's client presents the token to the group's homeserver `signin` within the token window and receives a session cookie named for the **group** pubky, not the member's. That is a second session, distinct from the user's `RING_GRANT_CAPABILITIES` session on the user's own homeserver. Authz compares session `user_pubkey` to pubky-host (`authz.rs`); a user session cannot write into a group tenant.

**Required scopes** (not a single shared write root):

```
/pub/hypercolor.app/v1/group/members/{memberPubky}/:rw
/pub/hypercolor.app/v1/group/:r
```

Optional, only if the member is allowed to seed blobs:

```
/pub/hypercolor.app/v1/group/blobs/:rw
```

Admin/root (group key session only):

```
/pub/hypercolor.app/v1/group/:rw
```

A shared `/pub/hypercolor.app/v1/group/:rw` granted to every member is **rejected by this ADR**. `Action::Write` is PUT/POST/**DELETE** (`capabilities.rs` module docs and `Action::Write`). There is no append-only action. A shared write prefix lets any member delete every other member's objects. Per-member prefixes confine delete to that member's own log. Content-addressed mirrors still recover those deletes.

This is the same mechanism Ring uses to grant Hypercolor `/pub/hypercolor.app/v1/:rw` over a user's key. The issuer is the group key instead of the user key. The bearer is the member's Hypercolor client instead of the user's Hypercolor client.

#### Capability expiry and revocation — UNAVAILABLE for v1

**AuthToken (the signed capability grant):**

- Has a `timestamp`, not an `expires_at` field (`pubky-common/src/auth.rs` `AuthToken`).
- `verify` accepts the token only if `timestamp` is within `TIMESTAMP_WINDOW` = 45 seconds of now (`auth.rs` `TIME_INTERVAL` / `TIMESTAMP_WINDOW`; errors `TooFarInTheFuture`, `Expired`).
- `AuthVerifier` rejects reuse of the same `(timestamp, public_key)` id (`AlreadyUsed`).
- Spec: `pubky-core/docs/AUTH.md` “AuthToken verification” and “Expiration is out of scope” for the *exchanged* session. Version 0: “No delegation.”

**Capability struct:**

- `{ scope, actions }` only. No expiry, no recipient public key, no revocation id (`capabilities.rs` `Capability`).

**Homeserver session (what the token is exchanged for):**

- Cookie max-age and `expires` are set to **one year**: `Duration::days(365)` in `create_session_and_cookie` (`pubky-homeserver/src/client_server/routes/auth.rs` lines 142–146).
- `SessionInfo` has `created_at` and `capabilities`. It has **no** `expires_at` (`pubky-common/src/session.rs`). FFI `expires_at` is hardcoded `None` (`pubky-sdk/src/ffi/types.rs`: “Not exposed in pubky-common SessionInfo”).
- `SessionRepository` implements only `create`, `get_by_secret`, and `delete` by secret. There is no list-by-user and no revoke-by-id (`pubky-homeserver/src/persistence/sql/entities/session.rs`).
- Tenant routes expose `GET /session` and `DELETE /session` only (`tenants/mod.rs` `.route("/session", get(session::session).delete(session::signout))`; `tenants/session.rs` `signout` deletes by the cookie’s secret). **Only the holder can revoke.** The owner cannot enumerate or revoke another party’s session.
- `AUTH.md` assumes “the user can always access all active sessions and revoke any session… from the Authenticator app.” That owner-side session directory **is not implemented** on the homeserver.

**Delegation / UKD:**

- Version 0 AuthToken: “No delegation” — issuer **is** the resource owner (`AUTH.md` “Limitations”).
- Unified Key Delegation AppCerts *do* have optional `expires_at` and a recommended revocation list in pkarr metadata (`docs/PUBKY_UNIFIED_KEY_DELEGATION_SPEC_v0.2.md` §5.3, §5.4, §11.5). AppCerts are **not** a homeserver write credential. This repo states that explicitly (`README.md`: “AppCert is UKD-only. It is not a homeserver credential”). UKD scopes are “capability hints” that “applications MUST NOT rely on… for core safety” (UKD spec §5.5).

**v1 posture:** treat owner-initiated revocation and server-side session expiry as **UNAVAILABLE**. A parallel effort is adding session expiry and owner-initiated revocation to the `BitcoinErrorLog/pubky-core` fork. That only helps Hypercolor if the *homeserver operators* we actually talk to deploy that code. v1 must not assume they will.

**What that costs:**

- A removed member’s homeserver session on *their prefix* may linger until they sign out or the HTTP cookie’s one-year expiry.
- Member removal therefore **cannot** cut off PUT/DELETE at the homeserver.
- Member removal **can** cut off new *plaintext* by rotating a membership-epoch key, distributed over Encrypted Links, enforced by **compliant clients**. A removed member who still holds an old epoch key can read that epoch. A removed member who still holds a session can still write ciphertext to their prefix; compliant readers ignore it.
- A non-compliant or hostile client can keep writing junk to that prefix for up to a year. Mirrors and readers drop it after verification. Storage cost sits on the group tenant until the session dies or an operator intervenes out of band.

Tokens are bearer credentials. Deliver them only over Encrypted Links. A leaked unused token is useful for 45 seconds. A leaked session cookie is useful for up to a year.

### 3. Content-addressed, signed message log

Every group event is an immutable object:

```
{
  "version": 1,
  "kind": "hypercolor.group.event.v1",
  "group_pubky": "...",
  "event_id": "<uuid>",
  "author_pubky": "...",
  "sent_at": <unix-ms>,
  "parents": ["<sha256>", "..."],
  "body_kind": "message" | "membership" | "reaction" | "edit" | "delete" | "attachment-ref",
  "body": { ... },
  "signature": "<ed25519 over the canonical bytes excluding signature>"
}
```

`id(event) = sha256(canonical_bytes_including_signature)`. Storage path is `{memberPrefix}/{id}`. A host that serves bytes whose hash does not match the path is ignored. A signature that does not verify under `author_pubky` is ignored. An author who is not an *active* member at the membership epoch named by the event's parent chain is ignored. Those three checks are what make member-side mirroring safe: a hostile mirror cannot forge, cannot silently drop a known parent (the child advertises the missing hash), and cannot reorder (parents define happen-before).

The object stored on the group homeserver is the **ciphertext** of this event (or a sealed blob). Putting `chat.group.message.v0` plaintext under the group prefix would publish the room. Private-group DAG without encryption is not allowed.

#### Ordering

This is a **causal event DAG**, not a text CRDT.

- Event A happens-before B if A is in B's ancestor set.
- Concurrent events (neither ancestor of the other) are both kept.
- Display order: topological order, then `(sent_at, event_id)` as a tie-break. `sent_at` is sender wall clock, the same display-only clock 1:1 messages already use (`src/types/link.ts` `ChatMessageEnvelope.sent_at`).
- Edits and deletes are new events targeting `(author, event_id)`, same as today's `chat.group.edit.v0` / `delete.v0`. They do not mutate the original object.
- Membership events are in the same DAG. A content event is authorized iff every membership event in its ancestor set, applied in causal order, leaves `author_pubky` active.

We do not pick LWW or a sequence number as the source of truth. LWW would let a late writer hide concurrent history. A single sequencer would re-introduce a location-bound authority.

#### Heads

Each member writes `/members/{memberPubky}/heads.json` listing the hashes they consider tips (the events they authored or merged that have no known children in their store). Readers:

1. List active members from the signed (decrypted) manifest / membership DAG.
2. GET each member's `heads.json` (and/or list the member prefix).
3. Union heads, fetch missing parents recursively, verify.

The group-key `heads.json` is a cache of that union for cold-start. It is not trusted more than any member file. If it omits a hash that a member still advertises, the member file wins.

Partial replication is allowed: a client may stop walking parents once it has a contiguous window it can display. It must not claim a hash is absent, only that it has not fetched it.

### 4. Attachments: content-addressed and re-seedable

Today `location` is both the fetch URL and the AEAD AAD (`attachment.ts`). That single field is why a replica at a different path cannot decrypt.

Split the concepts:

| Field | Role |
|---|---|
| `blob_id` | `sha256(ciphertext)` — identity |
| `aad_id` | The string bound as AAD. Equal to `blob_id` (hex or unpadded base64url). **Not** a `pubky://` URL |
| `replicas` | One or more `pubky://{anyPubky}/pub/hypercolor.app/v1/…/{blob_id}` hints |

Encrypt: AAD = `aad_id`. Put ciphertext at any replica path whose final segment is `blob_id`. Decrypt: fetch any replica, reject if `sha256(bytes) !== blob_id`, then open with key/nonce and AAD `aad_id`.

Any member who has the ciphertext may PUT it to:

- their own homeserver under `/pub/hypercolor.app/v1/blobs/{blob_id}`, and/or
- the group blob prefix if they hold that capability.

A sender ban 404s the original replica. The access PAM still carries key/nonce (same Encrypted Link / group-fanout path as today). The next GET walks `replicas`, then asks peers for a re-seed (a small `hypercolor.blob.offer.v1` event in the DAG naming `blob_id`). Availability gap lasts until one online member who still has the bytes uploads them.

Do **not** map private attachments onto `PubkyAppFile` / `PubkyAppBlob` (`pubky-app-specs/src/models/file.rs` `PATH_SEGMENT = "files/"`). Specs files are plaintext metadata pointing at a plaintext blob. Nexus watcher indexes `PubkyAppFile`. Publishing a file record for a sealed DM attachment would either publish plaintext or publish a social-looking attachment that is not one. Public-room media is ADR 0002 (`PubkyAppFile` + `PubkyAppPost.attachments`).

#### Partial / opportunistic mirroring (media)

Text events are tiny relative to the 1000-byte Noise PAM ceiling (`LINK_MESSAGE_MAX_BYTES`) and to homeserver objects. Full N-way mirroring of text is cheap at the current private-group cap of 50 (`PRIVATE_GROUP_MEMBER_CAP`).

Media is not. 8 MiB plaintext × 50 members is 400 MiB per file if everyone mirrors everything. Do not do that.

Rules:

- **Required:** the author seeds at least one replica (own homeserver and/or group blob prefix).
- **Opportunistic:** a member who *resolves* (downloads and decrypts) an attachment MAY re-seed it. The client does this for images at or under `ATTACHMENT_THUMBNAIL_MAX_BYTES` automatically; for full 8 MiB blobs only when the user opened the file or when a "keep available" control is on.
- **Not in this design:** chunked streaming above 8 MiB. `config.ts` already forbids raising `ATTACHMENT_MAX_BYTES` without a chunked transfer. This ADR does not invent chunking.

Homeserver quota is operator policy: `user_storage_quota_mb = 0` means unlimited (`pubky-homeserver` `config.default.toml`; `create_router` maps 0 → `None`). A non-zero quota is enforced (`e2e/src/tests/storage.rs` `put_quota_applied`). Group tenants that host many blobs will hit whatever the operator set. Mirroring onto *member* homeservers spreads that cost.

### 5. Forkability (admin capture)

The group key holder can:

- move the mailbox (legitimate migration),
- refuse to publish a membership remove,
- issue sessions to new members the others did not want,
- disappear with the secret.

We do not add a voting contract, a multi-sig pkarr, or an on-homeserver appeal process. Those would be new authorities.

Because history is signed and content-addressed, any subset of members can:

1. Take a hash they all have (`log_root` or a later head).
2. Generate a new group keypair.
3. Publish a new manifest with `predecessor_group` / `predecessor_head` set.
4. Issue new per-member capabilities on the new identity.
5. Invite via `hypercolor://join-group?group={new}&head={hash}`.

The old group pubky still resolves wherever the old key holder's pkarr points. Clients that trust a specific invite keep following that name. Clients that switch, switch. Split-brain is visible: two names, a shared ancestor hash, diverging heads. That is the product. It is the same honesty we already accept for user key loss — there is no authority that can glue the room back together.

Forking does **not** revoke the old key's ability to keep writing under the old name. Members who leave stop reading it. Ciphertext they already have remains readable (see Hard parts).

Forking a private group is **not** the public-room moderation story. Tags cannot be captured (there is no `(:Tag)` node; nexus-scout `/llms.txt`: “Tags are not nodes”). Competing public feeds on the same label are ADR 0002.

### 6. Local indexer — private SoT, public accelerator

SQLite is already the local store for contacts, threads, links, and group rows (`getDb`, schema v4–v13). After first hydration, the user's own *private* graph lives there.

**Source of truth (private):**

- Manual contacts: local only (`addManualContact`).
- Encrypted Links, DM bodies, private-group events the device decrypted.
- Outbound follows **files** on the user’s homeserver, *if* the user opted into follows import (ADR 0002). The files are already public. The Hypercolor contact row is not, until we copy it. Copy is one-way and behind a toggle.

**Not source of truth for authorization:**

- Nexus `following` / `followers` / `friends` / `user` (`NexusClient`). Results are hints. Confirm `isFollowing` against a follows file on *our* homeserver before the flag authorizes `wotGate` auto-accept. Confirm `isFollower` against *their* homeserver when we already know their pubky, or leave the flag unset.
- nexus-scout Cypher. Discovery only, opt-in, never attached to a private thread (ADR 0002).

A hostile Nexus can omit peers (we walk homeserver follows and still see them, if opted in), invent peers (homeserver confirm fails; we do not set the flag), or be down (we are slower). It cannot make the client believe a follow that the homeserver does not hold.

Display name / avatar: treat Nexus `UserView` as a cache; prefer `pubky://{pubky}/pub/pubky.app/profile.json` (`pubky-app-specs/src/models/user.rs` `PubkyAppUser` URI comment and `PATH_SEGMENT = "profile.json"`). If the homeserver GET fails, show the Nexus name as unverified.

Indexer URL stays configurable (`AppConfig.getNexusBaseUrl` / `EXPO_PUBLIC_NEXUS_URL`). The client must not embed “Nexus said so” into authorization. `wotGate.classifyInboundPeer` auto-accepts on `isMutual || isFollowing || addedManually || hasEstablishedConversation` (`src/services/link/wotGate.ts`). Those flags must be homeserver-verified (or a genuine manual add) before they authorize anything.

`TrustEngine` scores are sort-only and never block delivery (`src/services/TrustEngine.ts` file header). Keep it that way. Do not feed public tags into auto-accept.

#### Cold-start cost (honest)

Nexus today: a handful of HTTP GETs to one host. For a user with a few hundred follows, graph hydration is typically one to a few seconds.

Homeserver-only, same graph:

- 1 directory list of `/pub/pubky.app/follows/` (one pkarr resolve + one GET).
- Up to N profile GETs. `PROFILE_HYDRATE_CONCURRENCY` is 4 (`config.ts`) and currently has no production reader.
- Each `publicGet` is pkarr + HTTPS. Budget 100–300 ms per peer on a good path.
- Concurrent 4 at N=200 is on the order of 15–60 seconds, not 2.

This cost is paid only if the user opts into follows import. New device without backup: Encrypted Links still re-handshake. A missing indexer on a new device with a large *public* graph will feel like a slow import, if the UI says so.

Inbound-only discovery (people who follow you that you have never listed) is the one Nexus capability homeserver walking does not replace unless you already know their pubky. Product copy: “People who follow you appear when they message you, when you look them up, or when an indexer hint confirms — and only after you opted into graph features.” Unilateral `isFollower` never auto-accepts (`wotGate` table).

## Property changes (private domain)

| Property | Before | After |
|---|---|---|
| **1:1 conversation addressing** | `pubky` + `receiverPath` + `noisePublicKey` via pkarr (already) | Unchanged |
| **Private-group undelivered messages** | Sit in sender Paykit outbox (sender homeserver) | Also (or instead) on the group log under the author's prefix, encrypted; late joiners fetch the DAG for epochs they are given |
| **Private-group already-received messages** | Local SQLite; survive sender ban | Unchanged, plus optional re-seed to the group log |
| **Attachment availability after sender ban** | 404 at sender-bound `location`; AAD prevents honest re-host | Other replicas / re-seed; AAD is `blob_id` |
| **Ban survival (private group history)** | Coupled to each author's operator | Coupled to the group mailbox *and* any member who mirrored; pkarr move relocates the mailbox |
| **Write authority** | 1:1 Noise sender + local membership policy | Author signature + membership DAG. Homeserver session is transport, not authorship |
| **Admin / key-holder power** | Founder-bound `channel_id`; admin ops are policy on each device | Soft authority over pkarr + session issuance; constrained by fork |
| **Membership write cutoff** | Policy only, no shared secret to rotate | Policy + ignore removed authors immediately. Homeserver session may linger up to 1 year on *their prefix only*. Owner revocation UNAVAILABLE in v1 |
| **Cryptographic removal cutoff (new ciphertext)** | None (no group secret) | Membership-epoch keys over Encrypted Links, enforced by compliant clients, not by the homeserver |
| **Indexer / Nexus** | Designed as the social-graph read path; web uses it for profile names | Untrusted accelerator of the *public* graph. Never a store of DMs or private groups |
| **Public channels** | Documented as `/pub/hypercolor.app/v1/public-channels/` + `chat.public.message.v0`; unimplemented on web | **Out of this ADR.** ADR 0002: posts + tags + feeds. Group tenant is not the public message store |
| **Metadata exposure** | Attachment ciphertext paths are world-readable. Nexus sees follow-graph queries | Group ciphertext blobs remain world-readable (`/pub` model). Private event *bodies* stay encrypted. A plaintext member roster is forbidden |
| **Key loss** | User key loss is unrecoverable | Group key loss is unrecoverable for that name; history remains forkable |

## Consequences

### Positive

- Private group history and attachments inherit the same “mailbox is replaceable” property users already have, without publishing the room as posts.
- Author or sender homeserver ban is an availability event, not an erasure event, once one replica exists.
- Membership authorization is checkable offline from a signed log.
- Mirrors are safe to fetch from because forgery and silent rewrite fail verification.
- Nexus outage or hostility cannot invent follows or hide the user's own outbound follow files (when the user opted in).
- Forking is a specified user action, not an undefined break-glass.
- Public chat is no longer blocked on this protocol work (ADR 0003 items 1–3).

### Negative

- Two sessions per member (user tenant + group tenant). More cookie/session state in a client that already treats XSS as full compromise (`SECURITY.md` “XSS is the kill shot”).
- Group key custody is a new secret class. Web is a bad place for it.
- DAG sync, head union, and replica walking are more code than today's `sent_at` + UUID files and pairwise fan-out.
- N-way media mirroring has a real storage cost; opportunistic rules add product surface.
- Removed members keep old plaintext and, for up to a year, write/delete on their own prefix. v1 has no owner revoke.
- Homeserver operators must accept group tenants (signup tokens, quota). That is a deployment dependency, not a protocol miracle.
- Old groups cannot keep their `founderPubky:uuid` identifier (Migration Path).
- Ciphertext on `/pub` reveals *that* a group exists, approximate size, and timing of writes, even when bodies are sealed. Traffic analysis is in scope; hiding the tenant is not possible under current authz.

### Neutral

- Public metadata exposure of `/pub` objects is unchanged in kind. We relocate private-group ciphertext from author tenants / pairwise outboxes to a group tenant; we do not make `/pub` private.
- Private groups can keep pairwise fan-out as a *delivery accelerator* even after the DAG exists (notify members “new head = H”). The DAG is SoT; PAM is a hint.

## Hard parts (not solved)

### Membership revocation

A removed member retains keys for every ciphertext they already decrypted. That is true of Signal, MLS, and this design. No ADR will undo physics.

Pubky capability sessions are bearer and, after the 45-second token exchange, last up to one year with only self-signout as revocation. That is **worse** than MLS for *write* cutoff and is not fixable in Hypercolor alone. v1 treats homeserver revocation as unavailable even if our fork grows the API.

**MLS (RFC 9420), briefly.** MLS is a continuous group key-agreement protocol. Members hold leaves in a ratchet tree (TreeKEM). A `Commit` advances an **epoch** and produces a new `epoch_secret`. `Remove` blanks a leaf; the removed member cannot derive later epoch secrets. `Welcome` onboard a joiner into the new epoch. Application messages are AEAD'd under epoch-derived keys. Properties MLS actually gives: new ciphertext after remove is unreadable to the removed member (if everyone commits correctly); already-decrypted messages stay readable; a member who exfiltrated an epoch key can read that epoch until the next update. Properties it does not give: remote wipe of old plaintext; protection against a member who still has a homeserver write session (MLS is not an authorization layer for HTTP PUT).

Signal's Sender Keys rotate the sender key after a remove; same “old messages stay, new messages do not” shape, with weaker forward secrecy than MLS.

**Recommendation:** do **not** adopt MLS in the first implementation. Approximate the one property private groups will need — *new* private bodies unread by removed members — with a **membership-epoch symmetric key** distributed over existing Encrypted Links (the app already fans out `chat.group.membership.v0` that way, cap 50). On `remove` / `leave`, bump `membershipEpoch` (already a column on `GroupChannel`), mint a new epoch key, send it to remaining members only. Encrypt private DAG bodies (and the stored manifest) to the epoch key. Accept: (1) old epochs remain readable to anyone who had the key; (2) a removed member's lingering homeserver session can still mutate *their prefix*, which compliant readers ignore; (3) this is O(n) pairwise, acceptable at n≤50, not a substitute for MLS at hundreds of members.

Adopt MLS later if private groups must grow past pairwise fan-out or need PCS/FS that a single epoch key cannot provide. Full RFC 9420 is a new stack (ciphersuite, tree, Commit/Welcome, replay) and is not a Pubky primitive.

### Group key custody

The group secret is a soft authority over name and session issuance. Forkability lets members abandon a captured name; it does not stop the capturer from operating the old name. Threshold / Shamir custody of the group secret is not a current Pubky primitive and is not part of this decision. Put the secret in an authenticator, not in the web XSS domain, if the authenticator can hold it.

### Storage cost

Text DAG + membership: negligible at n=50. Media: real. Opportunistic mirroring (§4) is mandatory, not optional guidance. Group-tenant quota is the operator's.

### DAG complexity

Today private messages are UUID events on a pairwise link. A DAG needs parent sets, head union, partial fetch, and authorization against a membership prefix of the DAG. That is more failure modes (missing parents, deferred apply — the app already has `GroupDeferredEvent` for a simpler case). The payoff is fungible hosting. Do not ship the DAG for private plaintext.

### Key loss

No authority means no recovery. User key loss already works that way. Group key loss loses the *name* and the ability to issue sessions. Objects remain. The recovery path is fork, not support.

## Alternatives Considered

### Keep author-sharded public channels / invent a Hypercolor public schema

**Description:** Continue specifying `PUBLIC_CHANNEL_PATH_PREFIX` and `chat.public.message.v0`, or move those files onto a group tenant.

**Pros:** Fits the existing Ring grant (`HYPERCOLOR_WRITE_CAPABILITY`); no `/pub/pubky.app/` write.

**Cons:** `Resource::Unknown`; Nexus drop; web never implemented the reader; reproduces the invisibility the graph review named.

**Why not chosen:** Public chat is ADR 0002. The grant gap is a product screen, not a reason to fragment the graph. See also “What this amendment rejects” below.

### Shared group write prefix for all members

**Description:** `/pub/hypercolor.app/v1/group/:rw` to every member.

**Pros:** Simpler capability issuance; any member can host any object in one tree.

**Cons:** `w` includes DELETE. One hostile or removed-but-still-authed member can empty the group tenant. No append-only action exists.

**Why not chosen:** Per-member prefixes plus content-addressed re-seed give multi-writer without shared delete.

### Sequencer / founder-ordered log

**Description:** Founder (or group key) assigns sequence numbers.

**Pros:** Easy display order; easy “latest” fetch.

**Cons:** The sequencer is a location-and-key authority. Capture or disappearance stalls the log. Conflicts with forkability.

**Why not chosen:** Causal DAG keeps ordering local to the objects.

### Full MLS now

**Description:** RFC 9420 for private groups from day one.

**Pros:** Best-in-class epoch secrets; standardized.

**Cons:** Large implementation; does not revoke homeserver sessions; does not wipe old plaintext; current n≤50 already has pairwise Encrypted Links that can carry an epoch key.

**Why not chosen:** Wrong first increment. Revisit if groups grow or we need PCS beyond epoch keys.

### Eliminate Nexus

**Description:** Never query an indexer.

**Pros:** One fewer host.

**Cons:** Cold start and inbound-follow discovery become slow or incomplete for users who *want* the public graph.

**Why not chosen:** De-authorize. Keep the accelerator. Do not attach it to private threads.

### Encrypted `/priv` group space

**Description:** Put the private DAG under a non-`/pub` path.

**Pros:** Homeserver would hide bytes from the world.

**Cons:** Homeserver forbids writes outside `/pub/` (`authz.rs`). `/priv` delegated readers are an explicit UKD non-goal. Not available.

**Why not chosen:** Impossible with current homeserver policy. Private confidentiality stays on epoch keys / Encrypted Links.

### Make a private group a tag

**Description:** Tag the group pubky `members` / room label so Nexus can discover it.

**Pros:** Free directory.

**Cons:** A tag is world-readable (`PubkyAppTag { uri, label, created_at }`). Membership-as-tag is a public roster. That contradicts encrypted messaging and this ADR’s capability gate.

**Why not chosen:** Deanonymising. Explicitly rejected.

### Mandatory follows-derived roster as this ADR’s Phase 1

**Description:** On Enable Messaging, list `/pub/pubky.app/follows/` and populate Hypercolor contacts.

**Pros:** Makes `wotGate`’s `isFollowing` row real.

**Cons:** `/pub/pubky.app/follows/` is a public contact list. Treating it as the messenger roster without a toggle is how you quietly import a world-readable address book into auto-accept.

**Why not chosen:** Opt-in, read-only, ADR 0003 item 1. This ADR does not own that increment.

## Migration Path

Today's identifiers and paths cannot be rewritten in place without lying about authorship and breaking invites already in the world.

### Identifiers

| Today | After |
|---|---|
| Private `channel_id` = `{founderPubky}:{uuid}` | New groups: `groupPubky` (52-char z-base32). Old ids remain valid for v0 groups |
| Attachment `location` = sender `pubky://…/attachments/{uuid}` | New: `blob_id` + `replicas[]`. Old envelopes still decode |
| Public `channel_id` / `PUBLIC_CHANNEL_PATH_PREFIX` | Not migrated by this ADR. ADR 0002 drops the schema for new work |

Wire kinds (`chat.group.*.v0`, `chat.attachment.v0`) stay readable forever. New kinds (`hypercolor.group.event.v1`, `hypercolor.group.manifest.v1`, a v1 attachment envelope with `blob_id`) are additive. Unknown kinds already sit on `link_stream_items` unprocessed (`src/types/link.ts` header). `chat.public.message.v0` is not a successor target.

### Old private groups: re-create, do not migrate in place

A founder-bound channel has no group keypair and no group tenant. Inventing a key and claiming the old `channel_id` would make the founder key and the group key the same only when the founder *is* the group — which re-binds the room to one human's mailbox and secret. That is not a migration; it is a rename of the problem.

Procedure for an admin who wants the new properties:

1. Create a new group pubky; publish manifest with `predecessor_head` if they have a local hash of the old transcript (optional, informational).
2. Re-invite members (new link). Private groups still need Encrypted Links.
3. Optionally re-publish local history as signed DAG events (authors can only sign their own old messages; the client must not forge signatures for other authors). History the device does not have, and cannot ask a still-live author to re-sign, stays on the old channel.
4. Leave the old channel as read-only once the new one is live.

Clients keep v0 read/write until a later ADR sunsets it. Both trees can be open at once.

### Attachments

v0 `chat.attachment.v0` with sender-bound `location` remains valid. Resolvers try that URL first. v1 envelopes add `blob_id` / `aad_id` / `replicas`. A client that still has the plaintext (or the ciphertext plus keys) may re-seed a v1 replica without the original sender. AAD changes, so this is a **re-encrypt** or a **new field that was used at encrypt time**. Existing v0 blobs cannot be honestly re-hosted under a new path without re-encryption, because AAD is the old location. Re-seed of v0 therefore means: decrypt locally, encrypt as v1 with AAD=`blob_id`, publish replica, send a new access PAM or a DAG `attachment-ref`. That is a new event, not a silent rewrite.

### Indexer

No wire migration. Follows import is ADR 0003 item 1, opt-in. Flags already in SQLite stay; next verify pass may clear unverified inbound flags (`setContactRelationshipFlags` is the existing authoritative write).

## Phased work (private protocol only)

These phases are independently shippable. They are **not** the first product increments. ADR 0003 places the cheap public-graph items (opt-in follows import, tag-channel view, username search) *ahead* of this protocol work and forbids blocking them on it.

### P-A — Attachment v1 (cheapest *protocol* win)

Add `blob_id` / `aad_id` / `replicas` to a new attachment envelope. Encrypt with AAD=`aad_id`. Resolver walks replicas; on 404, request re-seed from group members who have the file. Keep v0 decode. Proof: upload, delete the sender replica, re-seed from a second member, decrypt.

**Publicly visible:** ciphertext bytes at replica URLs under `/pub` (size, timing, `blob_id`). Not the plaintext, if the AEAD holds.

### P-B — Group pubky for *private* groups

Create group key (authenticator), signup, encrypted manifest, per-member prefixes. Invites use `hypercolor://join-group`. Do not convert old private channels in place. Do not use this phase for public rooms. Proof: three members write encrypted events to their prefixes; ban simulation (stop serving one author's *user* homeserver) still serves their group-prefix objects; move the group pkarr and read from the new host.

**Publicly visible:** that a group tenant exists; ciphertext volume; member-prefix *path names* include `{memberPubky}` unless we encrypt path segments (we cannot: the capability scope *is* that path). **The member pubky in the prefix is a public membership signal.** Mitigate by treating prefix names as known-to-the-operator-and-anyone-who-lists-the-tree, and by not publishing the group pubky to Nexus/tags. Compliant clients still encrypt bodies. This leak is inherent in per-member `/pub` prefixes; call it out in the UI (“people who can see the group homeserver can see who has a write prefix”).

### P-C — Private-group DAG + epoch keys

Store encrypted events on the group tenant. Fan-out PAM may still notify. Epoch key on membership change. Proof: remove a member; they cannot decrypt a post-epoch body; they can still PUT to their prefix and compliant clients ignore it.

**Publicly visible:** same as P-B, plus write timing as heads move.

### P-D — Fork UX

Export head hash, new group key, predecessor fields, invite. Proof: two remaining members fork without the founder secret and continue; the old name still exists.

**Publicly visible:** a new group tenant and its prefixes.

Do not start P-C before P-A if private attachments must survive a sender ban — the DAG will point at `blob_id`s.

Do not start P-B as a public-channel vehicle. That was the original Phase 3 and is rejected.

## What this amendment rejects (from the first draft of this ADR)

1. **Group-as-pubky as the store for public messages** (original Phase 3, and the “public-channel history durability → group tenant” row). Evidence: `Resource::Unknown` + watcher drop + unused web reader. Public durability is the same author-sharded model pubky.app already uses for posts. That is ADR 0002, not a group tree.
2. **`visibility: "public"` plaintext DAG on `/pub/hypercolor.app/v1/group/`.** That publishes the room *and* hides it from every existing indexer.
3. **Invite-and-id-only public discovery** (“Nexus does not index chat URIs today” as a constraint). That sentence in `src/types/group.ts` describes a namespace choice, not a Nexus limitation.
4. **Mandatory Phase 1 follows hydration as this ADR’s first increment.** Follows import is opt-in (ADR 0003 item 1).
5. **Shipping `/pub/hypercolor.app/v1/public-channels/` or `chat.public.message.v0` on web** as the way public channels “should appear.” ADR 0002 drops both.

## Open Questions

1. **Can Pubky Ring hold a second keypair that is a group identity, and sign AuthTokens for it without treating it as a user account?** Resolves group-secret custody. If no, founders on web either hold the secret in JS (rejected for production) or group creation is mobile/Ring-only until Ring grows the feature.
2. **Will homeserver operators deploy owner-visible session list + revoke?** Resolves member write-cutoff latency. Track `SessionRepository` and `tenants/session.rs`. Until operators adopt a fork that has it, assume one-year bearer sessions and client-enforced epoch keys.
3. **Will `Capability` / `AuthToken` gain a recipient binding or expires_at that survives exchange?** Would let us issue member-bound, short-TTL grants. Version 0 explicitly deferred delegation because of revocation lookups (`AUTH.md` “No delegation”).
4. **Default / staging `user_storage_quota_mb` for group tenants.** Code default is 0 (unlimited). A low operator quota makes group-hosted media fail in ways author-sharded media spread across N quotas would not. Measure before P-B media.
5. **Did mobile Hypercolor (pin `c7157aaa1b338dd1d8545e82f639007cba945631`) ever write `public-channels/`?** This web tree never writes them (`GroupService` `private-only`). Resolve by grepping the mobile repo. If mobile already wrote that path, ADR 0002 needs a read-only importer or a redirect, not a silent drop. This ADR does not implement either.
6. **Private-group late joiner vs WoT.** A new member fetching an encrypted DAG needs epoch keys for the epochs they are allowed to read. Which epochs? Recommendation: only the current epoch and forward, plus whatever history remaining members choose to re-encrypt. Past epochs are a disclosure decision, not automatic. Confirm product-side before P-C.
7. **Head advertisement vs homeserver events API.** Homeserver has an events cursor (`events_service`). Using it as a sync hint is an optimization. It must not become a trusted sequencer. Decide at P-B implementation whether to poll listings only or also subscribe to events.
8. **Can we avoid putting `memberPubky` in the public path?** Capability scopes are path prefixes (`capabilities.rs`). Authz is `path.starts_with(&cap.scope)` (`authz.rs`). A random per-member token in the path would hide the pubky from directory listings but must still be issued in the capability and stored somewhere the other members can list. A group-key-written encrypted map of `token → memberPubky` is a possible mitigation. Not designed here; if we ship P-B without it, the leak in P-B’s “publicly visible” row stands.

## Implementation Notes

- Do not implement this ADR in the same change that accepts it. Wire-copied files under the mobile pin (`README.md` wire-contract pin `c7157aaa…`) cannot grow v1 kinds without a pin bump coordinated with `BitcoinErrorLog/hypercolor`.
- Group session cookies are HttpOnly on the group host, same as user sessions. JS still must not treat `SessionHandle.exportSession()` as a cookie (`PaykitLinkWeb` comment).
- `GroupService` public channels stay out of scope. Public rooms appear via ADR 0002, not via this DAG.
- Proof language: a skipped test is not a green live proof (existing README rule). Phase proofs above are the acceptance bar.
- Privacy-sensitive implementation of P-A through P-D requires a Kimi sensitive-area audit before merge (ADR 0003).

## Related Decisions

- [ADR 0002](0002-public-chat-as-graph.md) — public chat as posts + tags + feeds; privacy analysis; nexus-scout.
- [ADR 0003](0003-chat-architecture-roadmap.md) — unified ordered roadmap.
- Does not supersede the pairwise private-group design in `src/types/group.ts`; it defines the successor for **new private groups** after P-C.

## References

- Pubky Auth spec: `pubky-core/docs/AUTH.md` (also `docs/mdbook/src/spec/auth.md`)
- Capabilities: `pubky-core/pubky-common/src/capabilities.rs` (`Capability`, `Action::Write`)
- AuthToken: `pubky-core/pubky-common/src/auth.rs` (`TIMESTAMP_WINDOW`, version 0)
- SessionInfo: `pubky-core/pubky-common/src/session.rs`
- Homeserver authz / session cookie / signout: `pubky-homeserver/src/client_server/layers/authz.rs` `authorize`, `routes/auth.rs` `create_session_and_cookie` (`Duration::days(365)`), `routes/tenants/session.rs` `signout`, `persistence/sql/entities/session.rs` `SessionRepository`
- Unauthorized PUT: `pubky-core/e2e/src/tests/storage.rs` `unauthorized_put_delete`
- UKD AppCert expiry/revocation: `pubky-core/docs/PUBKY_UNIFIED_KEY_DELEGATION_SPEC_v0.2.md`
- Specs `Resource`: `pubky-app-specs/src/uri/resource.rs`
- Nexus watcher: `pubky-nexus/nexus-watcher/src/events/mod.rs`
- MLS: RFC 9420 (The Messaging Layer Security Protocol)
- Hypercolor pin: `c7157aaa1b338dd1d8545e82f639007cba945631`
- ADR style: `pubky-app/docs/adr/TEMPLATE.md`
