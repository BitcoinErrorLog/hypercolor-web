# ADR 0003: Unified Chat Architecture Roadmap

## Status

Proposed — 2026-08-31

This is the single ordered sequence that replaces the phase lists in the first draft of ADR 0001 and in the graph-utilisation review. It does not add protocol. It sequences the two domains decided in [ADR 0001](0001-group-as-pubky.md) (private) and [ADR 0002](0002-public-chat-as-graph.md) (public).

Supporting analysis: [graph-utilisation-review.md](../graph-utilisation-review.md).

## How to read this list

Each item has:

- **User-visible value** — what a person using the app can do after it ships.
- **Effort** — relative, for this web tree. `S` = days, existing APIs/types. `M` = a week-class feature. `L` = multi-week protocol + UX.
- **Protocol change** — whether Hypercolor wire kinds, homeserver auth, or specs objects change. A new Ring *grant string* is not a protocol change; it is a product capability request.
- **Privacy-sensitive** — if yes, a Kimi sensitive-area audit is required before merge (`kimi-sensitive-audit` skill). Do not mark those items done on a green unit test alone.
- **Publicly visible** — what a third party can observe after the item ships. A design that maximises graph power while quietly deanonymising a chat user is a bad design; that is called out on the items where it applies.

Items 1–3 are the graph review’s ranked gaps 1–3. They are cheap, need no protocol change, and **must not be blocked** behind ADR 0001’s group-as-pubky / DAG / epoch-key work.

After item 3, later items may be prepared in parallel *implementation* as long as they do not gate 1–3. The number is the product order: ship in this sequence unless a later ADR revises it.

## Ordered sequence

### 1. Opt-in read-only follows import

- **User-visible value:** Contacts gain Following / Mutual / Follower badges that `relationshipBadges` / `contactRank` already render (`src/lib/contacts-sort.ts`). Inbound Encrypted Links from people the user follows auto-accept, as `classifyInboundPeer` already specifies (`src/services/link/wotGate.ts`). Today those flags are never set (`addManualContact` preserves them; `NexusClient.following` / `.followers` / `.friends` and `StorageService.setContactRelationshipFlags` have no production caller).
- **Effort:** S. Types, Nexus wrappers, and the flag writer already exist. Toggle + hydration + homeserver confirm.
- **Protocol change:** No.
- **Privacy-sensitive:** Yes. Changes who is auto-accepted. Copies a world-readable follow list into the messenger.
- **Publicly visible:** The follow files were already world-readable at `/pub/pubky.app/follows/:user_id` (`PubkyAppFollow`). Import does not publish them. If hydration goes through Nexus, the indexer sees `GET /v0/user/{self}/following` (and followers/friends) — IP, time, user id. Prefer listing own homeserver follows when a session can (`publicGet` / directory GET). Do **not** PUT follows. Do **not** add strangers who merely follow the user. Default **off**. Copy: “Use my pubky.app follows to recognise people.”
- **Bad design if:** Enable Messaging silently turns a public social graph into a DM allow-list, or writes the Hypercolor contact book back out as follows.

### 2. Tag-channel view (read-only)

- **User-visible value:** A Channels / Discover surface that shows real rooms: `GET /v0/tags/hot` (`hot_tags_handler`, `TAGS_HOT_ROUTE`) and a timeline via `GET /v0/search/posts/by_tag/{tag}` (`search_posts_by_tag_handler`) and/or `GET /v0/stream/posts?tags=` (`PostStreamQuery`). Optional `reach=wot` after item 1. Composer disabled with “Posting here publishes to the public graph.”
- **Effort:** S–M. New view over existing REST. Reuse thread chrome. No Hypercolor path.
- **Protocol change:** No.
- **Privacy-sensitive:** Yes. Nexus sees every directory and timeline query.
- **Publicly visible:** Query path + tag + optional `viewer_id` / `observer_id` to the Nexus operator. Response bodies are already public posts. Opening the view is a public read, not a publish. Off unless the user opens the surface. Do not auto-join from DM history. Do not send peer lists from a private thread.
- **Bad design if:** The private inbox prefetches hot tags or “rooms this peer posts in” and thereby tells Nexus who you are talking to.

### 3. Username search on Add Contact

- **User-visible value:** `GET /v0/search/users/by_name/{prefix}` (`search_users_by_name_handler`) — and optionally `…/by_id/{prefix}` (`search_users_by_id_handler`) — so adding a contact is not paste-only z-base32. Selecting a result still goes through `addManualContact` (local row, `addedManually: true`, no follow write).
- **Effort:** S.
- **Protocol change:** No.
- **Privacy-sensitive:** Yes. The prefix is intent.
- **Publicly visible:** Nexus sees the prefix, IP, time. Adding locally is not a public write.
- **Bad design if:** Search-as-you-type runs from a private thread composer, or select writes a follow.

### 4. Request-row graph hints (labels only)

- **User-visible value:** On a pending inbound request, show `GET /v0/user/{peer}/tags` (`USER_TAGS_ROUTE`) and optionally `GET /v0/user/{id}/relationship/{viewer}` (`RELATIONSHIP_ROUTE`) as provenance (“12 people tagged `troll`; 2 are in your WoT”). `TrustEngine` stays sort-only. `classifyInboundPeer` does **not** read tags.
- **Effort:** S.
- **Protocol change:** No.
- **Privacy-sensitive:** Yes. Asking Nexus about an inbound peer tells the indexer who is trying to message you.
- **Publicly visible:** Nexus sees `{peer}` and that this client asked. Default: fetch only when the user opens the request row, not for every pending item in the background.
- **Bad design if:** Tags auto-accept, or every inbound pubky is queried on arrival.

### 5. Attachment v1 (content-addressed re-seed)

- **User-visible value:** Private attachments survive a sender homeserver ban once a second replica exists. New envelope: `blob_id` / `aad_id` / `replicas`; AAD = `aad_id` (ADR 0001 P-A). Keep `chat.attachment.v0` decode.
- **Effort:** M. New wire envelope + resolver + re-seed request. Pin bump with mobile.
- **Protocol change:** Yes (additive Hypercolor attachment envelope).
- **Privacy-sensitive:** Yes. Crypto, keys, ciphertext locations.
- **Publicly visible:** Ciphertext bytes at replica URLs under `/pub` (size, timing, `blob_id`). Not plaintext if the AEAD holds. Do not publish `PubkyAppFile` records for private blobs.
- **Bad design if:** Private attachments are mapped onto `PubkyAppFile` so Nexus treats them as social files.

### 6. Ring grant for `/pub/pubky.app/` (explained separately)

- **User-visible value:** The session can PUT posts, tags, feeds, and public files. Prerequisite for items 7–8. Request `/pub/pubky.app/:rw` or a narrower posts+tags+feeds+files+blobs write. **Separately explained** from `RING_GRANT_CAPABILITIES` (`/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw`).
- **Effort:** M. Authenticator UX + `capabilities.ts` cover check + Enable Messaging copy. Not a weekend if Ring UX is involved.
- **Protocol change:** No. Product capability request.
- **Privacy-sensitive:** Yes. Widens what this origin can publish as the user.
- **Publicly visible:** The grant string is seen by Ring and the homeserver, not by Nexus. The *use* of the grant is item 7.
- **Bad design if:** The Paykit enable screen silently adds social publish, or the grant includes follows-write “for later.”

### 7. Publish public messages as posts (drop the Hypercolor public schema)

- **User-visible value:** Composer on a tag-channel creates a `PubkyAppPost` and a `PubkyAppTag` in one local-first commit (same shape as pubky-app `TagApplication.commitCreate` + post create). Public media is `PubkyAppFile` / `PubkyAppBlob` + `attachments`. Stop implementing `/pub/hypercolor.app/v1/public-channels/` and stop emitting `chat.public.message.v0`.
- **Effort:** M. Needs item 6. Dual-read of old paths only if mobile already wrote them (open question).
- **Protocol change:** No new Hypercolor kind. Uses existing specs objects. Dropping the unused Hypercolor public schema is a product stop, not a wire rev.
- **Privacy-sensitive:** Yes. Every send is a world-readable post.
- **Publicly visible:** Post body, parent, tags, files — world, Nexus, scout, forever until author delete. Interest in the label is public. Grant screen and composer must say this.
- **Bad design if:** Composer dual-writes a Hypercolor path “just in case,” or tags a DM peer, or posts DM text into a tag-channel.

### 8. Saved room = `PubkyAppFeed`

- **User-visible value:** “Save this room” writes `/pub/pubky.app/feeds/:hash` (`PubkyAppFeed` / `PubkyAppFeedConfig`). Invite is the feed URI or `hypercolor://room?tag=`.
- **Effort:** S after item 7.
- **Protocol change:** No.
- **Privacy-sensitive:** Yes. A feed is a public subscription.
- **Publicly visible:** Feed JSON (name, tags, reach, sort, layout) to the world. Not a membership list; it is interest in that query.
- **Bad design if:** Saving a room also tags the user’s profile, or saving happens implicitly when they open a view.

### 9. Private group as a pubky (encrypted manifest, per-member prefixes)

- **User-visible value:** New private groups get a `groupPubky`, pkarr mailbox, and per-member write prefixes (ADR 0001 P-B). Invites: `hypercolor://join-group`. Old `{founderPubky}:{uuid}` groups stay on pairwise fan-out until item 10.
- **Effort:** L. Group key custody, signup, second session, capability issue over Encrypted Link.
- **Protocol change:** Yes (manifest, group session, path layout).
- **Privacy-sensitive:** Yes. New secret class, sessions, membership.
- **Publicly visible:** That a group tenant exists under `/pub/hypercolor.app/v1/group/`; ciphertext volume; **member pubkys in prefix paths** (ADR 0001 P-B leak) unless open question 8 is solved first. Not plaintext bodies. Not a Nexus object.
- **Bad design if:** This tenant is used as the store for public-channel messages, or the stored manifest is a plaintext roster, or `visibility: "public"` plaintext is allowed.

### 10. Private-group DAG + membership-epoch keys

- **User-visible value:** Shared encrypted history; late joiners fetch epochs they are given; remove cuts off *new* plaintext for compliant clients (ADR 0001 P-C). Homeserver write cutoff remains unavailable in v1 (`SessionRepository` has no owner revoke; cookie `Duration::days(365)`).
- **Effort:** L. DAG sync, epoch distribution, proofs.
- **Protocol change:** Yes (`hypercolor.group.event.v1`, epoch key PAM).
- **Privacy-sensitive:** Yes. Crypto, membership, lingering sessions.
- **Publicly visible:** Same as item 9, plus write timing as heads move. Removed members keep old plaintext and may PUT junk to their prefix for up to a year.
- **Bad design if:** The DAG stores plaintext, or the product claims the homeserver revoked the removed member, or MLS is promised as the v1 mechanism.

### 11. Fork UX for private groups

- **User-visible value:** Remaining members export a head hash, create a new group key, set `predecessor_*`, re-invite (ADR 0001 P-D). The old name keeps working for whoever still trusts it.
- **Effort:** M after item 10.
- **Protocol change:** Yes (predecessor fields already in the manifest; UX + invite).
- **Privacy-sensitive:** Yes. New group secret; who forked is visible as a new tenant.
- **Publicly visible:** A second group tenant and its prefixes. Not a tag fork. Do not present this as the public-room moderation story (competing feeds on a label are item 8).
- **Bad design if:** Forking is sold as capturing or erasing a public topic.

### 12. Opt-in nexus-scout box (discovery only)

- **User-visible value:** “Ask the graph” on public/discovery surfaces using `POST https://nexus-scout.pubky.app/v1/query`. Show the Cypher. Treat rows as claims. Default off.
- **Effort:** M. Query UI, sanitizer-aware errors, no inbox hook.
- **Protocol change:** No.
- **Privacy-sensitive:** Yes. Strongest intent leak of any discovery tool in this list.
- **Publicly visible:** Cypher + `params` (including investigated pubkys) to the scout operator. GET-with-query-string also leaks via URLs — use POST.
- **Bad design if:** Scout runs on inbound DM handling, or on every contact open, or is marketed as a chat transport. DMs are unmodeled (`/llms.txt` “Not modeled”).

### 13. Local indexer / Nexus events cursor (accelerator)

- **User-visible value:** After first hydration, SQLite holds public posts the user actually opened and (if opted in) verified follow flags. `GET /v0/events` (`EVENTS_ROUTE`) is an untrusted hint. Homeserver objects remain SoT.
- **Effort:** L. Do not block items 1–3 on this.
- **Protocol change:** No.
- **Privacy-sensitive:** Yes if the cursor is fetched with a viewer id or if private heads are ever sent to Nexus (they must not be).
- **Publicly visible:** If the client polls Nexus events, the operator sees that this user is syncing. Private group DAG sync must not go through Nexus.
- **Bad design if:** The events cursor becomes a trusted sequencer, or private `channel_id`s appear in indexer queries.

### 14. Optional public host key (compose, do not replace)

- **User-visible value:** A public community may have a group-pubky as *operator* (pins as collection posts, re-seeding public media, host-authored posts) **and** members still post as themselves with the room tag.
- **Effort:** L. Only after items 7 and 9.
- **Protocol change:** Reuses ADR 0001 group key + ADR 0002 posts. No third namespace.
- **Privacy-sensitive:** Yes.
- **Publicly visible:** Host posts/tags (world) plus the operator tenant leak in item 9. Do not tag the host `members`.
- **Bad design if:** The host tree is the only copy of the public messages (returns to `Resource::Unknown`).

## Explicitly out of sequence (rejected as items)

| Rejected increment | Why it is not on the list |
|---|---|
| Implement `/pub/hypercolor.app/v1/public-channels/` on web | ADR 0002 drop. Would reproduce Nexus invisibility. |
| Emit `chat.public.message.v0` | Same. |
| Group-as-pubky plaintext DAG for public channels (original ADR 0001 Phase 3) | Namespace conflict. |
| Mandatory follows roster on Enable Messaging | Item 1 is opt-in. |
| Write a follow on Add Contact | Publishes the messenger address book. |
| MLS as the v1 group ratchet | ADR 0001: epoch keys at n≤50; MLS later if needed. |
| Owner-initiated session revocation as a v1 dependency | `SessionRepository` cannot; operators may never deploy a fork that can. Item 10 does not wait on it. |
| Mute-via-Nexus as a room filter | Watcher ignores mute PUTs in this fork. |
| Scout-as-default rooms directory | Item 2 uses REST; item 12 is opt-in. |
| Mapping private attachments to `PubkyAppFile` | Item 5 forbids it. |

## Proof bar

A skipped test is not a green live proof. Item-level proofs:

1. Toggle off: no Nexus following fetch, flags unchanged. Toggle on: fake Nexus follow does not set `isFollowing` without a homeserver confirm (or a documented Nexus-only fallback if own-list is denied — then the UI says “unverified”). Disable Nexus: own follows still import if homeserver list works.
2. Open Discover, see posts that already exist on pubky.app for a known tag. Composer disabled. Private inbox does not fire those GETs.
3. Type a known staging name, select, contact appears with `addedManually`; no follows PUT.
4. Open one request row, see tags; a second pending row is not fetched until opened. Accept still follows `wotGate` only.
5. Upload, delete sender replica, re-seed from a second member, decrypt.
6. Grant screen shows pubky.app publish separately from Paykit. Session without that grant cannot PUT a post.
7. Published post is GET-able as `PubkyAppPost` and appears in `search/posts/by_tag`. No write under `PUBLIC_CHANNEL_PATH_PREFIX`.
8. Saved feed GET-able as `PubkyAppFeed`; a second client can open it by URI.
9. Three members, per-member prefixes, encrypted manifest; user-homeserver ban does not drop group-prefix objects.
10. Remove a member; they cannot decrypt a post-epoch body; they can still PUT to their prefix; compliant clients ignore it.
11. Two members fork without the founder secret; both names resolve.
12. Scout box off by default; enabling shows Cypher; private thread has no scout call site.
13. Point Nexus at a sink: already-opened public posts and local private state still render.
14. Host posts a tagged `PubkyAppPost`; Nexus search returns it; group tenant is not the only copy.

## Related decisions

- [ADR 0001](0001-group-as-pubky.md)
- [ADR 0002](0002-public-chat-as-graph.md)
- [README](README.md)
