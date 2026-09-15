# ADR 0002: Public Chat as Posts, Tags, and Feeds

## Status

Proposed — 2026-08-31

This is a design decision, not an implementation. Public-room *reads* can ship against APIs that already exist. Public-room *writes* need a Ring grant for `/pub/pubky.app/` that this app does not request today.

Companion: [ADR 0001](0001-group-as-pubky.md) (private DMs and groups). Execution order: [ADR 0003](0003-chat-architecture-roadmap.md). Supporting analysis: [graph-utilisation-review.md](../graph-utilisation-review.md).

## Context

The graph-utilisation review tested the thesis that “chat is a UX perspective change over the same graph pubky.app already uses.” The verdict: **it holds for public surfaces and fails for private messaging.** Specs and Nexus do not model DMs. nexus-scout’s schema says so in so many words. Collapsing the two domains is how you deanonymise a messenger.

This ADR takes the public half. It also records the privacy cost of every graph feature, because a design that maximises graph power while quietly publishing a chat user is a bad design.

### What the shared graph already is

A public utterance is a `PubkyAppPost` at `/pub/pubky.app/posts/:post_id` with optional `parent` for threading (`pubky-app-specs/src/models/post/mod.rs` `PubkyAppPost`: `content`, `kind`, `parent`, `embed`, `attachments`, `lock`).

A topic label is a `PubkyAppTag` `{ uri, label, created_at }` at `/pub/pubky.app/tags/:tag_id` (`pubky-app-specs/src/models/tag.rs` `PubkyAppTag`). Tags are claims, not rooms. The label lives on the relationship. nexus-scout `/llms.txt` (fetched 2026-08-31): “Tags are not nodes.” There is no `(:Tag)` to seize.

A saved room-shaped query is a `PubkyAppFeed` at `/pub/pubky.app/feeds/:feed_id` whose config is `{ tags, domain_tags, reach, layout, sort, content }` (`pubky-app-specs/src/models/feed.rs` `PubkyAppFeedConfig`; `HasIdPath` `PATH_SEGMENT = "feeds/"`). The feed id is a hash of the serialized config (`HashId::get_id_data`).

Nexus already streams and searches that combination:

- `GET /v0/search/posts/by_tag/{tag}` — `SEARCH_POSTS_BY_TAG_ROUTE`, handler `search_posts_by_tag_handler` (`pubky-nexus/nexus-webapi/src/routes/v0/endpoints.rs`, `search/posts.rs`).
- `GET /v0/stream/posts` with `tags` — `STREAM_POSTS_ROUTE`, query struct `PostStreamQuery` (`stream/posts.rs`).
- `GET /v0/tags/hot` — `TAGS_HOT_ROUTE`, handler `hot_tags_handler` (`tag/global.rs`). Optional `reach` + `user_id` together (`StreamReach` in `nexus-common/src/types/mod.rs`: `Followers`, `Following`, `Friends`, `Wot(u8)`).
- `GET /v0/search/users/by_name/{prefix}` and `…/by_id/{prefix}` — `search_users_by_name_handler`, `search_users_by_id_handler` (`search/users.rs`).

### What Hypercolor does instead

Enable Messaging requests `RING_GRANT_CAPABILITIES` = `/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw` (`src/types/link.ts`). It does **not** request `/pub/pubky.app/`. That is a capability-level decision to stay off the shared graph (`src/lib/capabilities.ts` `HYPERCOLOR_WRITE_SCOPE = "/pub/hypercolor.app/v1/"`).

The invented public-channel schema:

```
pubky://{author}/pub/hypercolor.app/v1/public-channels/{host}/{localId}/meta.json
pubky://{author}/pub/hypercolor.app/v1/public-channels/{host}/{localId}/messages/{sentAt}-{eventId}.json
kind: chat.public.message.v0
```

(`src/types/group.ts` `PUBLIC_CHANNEL_PATH_PREFIX`, `PUBLIC_CHANNEL_MESSAGE_KIND`, `publicChannelMessagesPrefix`.) Discovery is documented as “invite links … and known channel ids — **not tags**.” The same file says “Nexus does not index chat URIs today.”

Nexus does not index those URIs because they are not a `Resource`. `pubky-app-specs/src/uri/resource.rs` `Resource` has no Hypercolor variant; `Unknown` is `#[default]`. Watcher PUT handling matches known `PubkyAppObject` pairs and otherwise `debug!("Event type not handled, Resource: {other:?}")` (`pubky-nexus/nexus-watcher/src/events/mod.rs`). A public-channel PUT is dropped.

This web tree does not implement the reader. `GroupService` (“Public channels are out of scope on web”) throws `GroupServiceError("private-only", …)` (`src/services/group/GroupService.ts`). `HYPERCOLOR_WRITE_CAPABILITY`’s comment still names “public channels” as an owner write (`src/types/link.ts`). The schema is specified, unused, and invisible.

Follows are equally unwired. `Contact.isFollowing` claims homeserver `/pub/pubky.app/follows/` or Nexus following (`src/types/index.ts`). `ContactSource` is not a field on `Contact`. `NexusClient.followers` / `.following` / `.friends` have no production caller. `StorageService.setContactRelationshipFlags` has no caller. `PROFILE_HYDRATE_CONCURRENCY` has no reader. `addManualContact` optionally GETs `nexus.user()` for `details.name` and preserves existing flags; it never sets them from the graph. Adding a Hypercolor contact does not write a follow (and the current grant could not PUT `/pub/pubky.app/follows/:id` anyway).

`wotGate.classifyInboundPeer` will auto-accept on `isFollowing` / `isMutual` (`src/services/link/wotGate.ts`). Those bits are always false unless a backup restore carried them. A pubky.app friend is a request, same as a stranger, unless the user pasted them. `contactRank` / `relationshipBadges` in `src/lib/contacts-sort.ts` already render Following / Mutual / Follower — on flags that never become true.

### nexus-scout is not Nexus

nexus-scout is **not** part of `pubky-nexus`. This workspace’s Nexus tree has no scout crate. The product is a public, read-only Cypher HTTP gateway over Neo4j:

- Gateway: `https://nexus-scout.pubky.app`
- Query: `POST|GET /v1/query` (documented in `https://nexus-scout.pubky.app/llms.txt`, fetched 2026-08-31)
- Schema: `GET /v1/schema`
- No account, no API key. Sanitizer rejects writes, `CALL`, admin clauses, unbounded paths. Default page 25, hard cap 100 rows, ~10s timeout, path depth `*1..5`.

Nodes: `User`, `Post`, `File`. Edges: `FOLLOWS`, `AUTHORED`, `REPLIED`, `REPOSTED`, `TAGGED` (label on the edge), `BOOKMARKED`, `MENTIONED`, `MUTED`.

**Not modeled** (same `/llms.txt`): likes, reactions, upvotes, view counts, **direct messages**, per-item privacy flags, edit history, ranked full-text search.

A query reveals the querier’s intent to the gateway operator (IP, time, Cypher text, `params` including any pubky ids). GET-with-query-string also leaks via URL logs. Position: **opt-in, discovery-only, POST preferred, never attached to a private inbox.**

## Decision

1. **Public channels and rooms are a view over posts + tags + feeds.** They are not a Hypercolor homeserver tree and not a group-as-pubky log.
2. **Drop `/pub/hypercolor.app/v1/public-channels/` and `chat.public.message.v0` as product schemas.** Do not implement them on web. Do not dual-write new public messages there.
3. **The privacy boundary is explicit in the product.** Entering a tag-channel is a publish-or-read of *public* objects. The UI must say so. Private DMs and groups (ADR 0001) never become posts, tags, or feeds.
4. **Follows are never a mandatory roster.** Import is opt-in and read-only. Adding a Hypercolor contact does not write a follow.
5. **Nexus and nexus-scout are untrusted accelerators** of the public graph. They are not a chat transport. Queries from private surfaces are forbidden.
6. **A group-pubky may be an optional public *operator*** (later). It must still emit member utterances as ordinary posts. It must not be the only copy of a public message.

### Objects

| Layer | Object | Path | Role |
|---|---|---|---|
| Utterance | `PubkyAppPost` (`kind: short` or `long`, `parent` for thread) | `/pub/pubky.app/posts/:id` | The message |
| Topic | `PubkyAppTag` `{ uri: postUri, label }` | `/pub/pubky.app/tags/:hash` | Discovery key |
| Room (saved view) | `PubkyAppFeed` `{ name, feed: { tags, reach, sort, layout } }` | `/pub/pubky.app/feeds/:hash` | Named, shareable query |
| Public media | `PubkyAppFile` + `PubkyAppBlob` + `PubkyAppPost.attachments` | `/pub/pubky.app/files/:id`, `/blobs/:id` | Indexed attachments |
| Profile | `PubkyAppUser` | `/pub/pubky.app/profile.json` | Name / avatar verification |
| Follow (opt-in read) | `PubkyAppFollow` `{ created_at }` | `/pub/pubky.app/follows/:user_id` | Relationship hint, not a roster |
| Optional host | group-as-pubky (ADR 0001) | `/pub/hypercolor.app/v1/group/` | Operator only; not the message store |
| Private group / DM | **not these** | Encrypted Links or private DAG | ADR 0001 |

Saying “the channel is a tag” is the right slogan for discovery. A tag has no name, no reach, no sort, no owner beyond each claimant. A feed is the room object. Implementing only a tag is enough to *browse*. Implementing a feed is enough to *subscribe*. Neither needs `/pub/hypercolor.app/v1/public-channels/`.

### What that buys

1. Every pubky.app user who already tags `rust` is already in the channel.
2. WoT-filtered hot tags become the rooms directory (`hot_tags_handler` + `StreamReach::Wot`).
3. Moderation is the same mute/tag/reach policy as the social app, not a Hypercolor-only block list — with the mute caveat below.
4. nexus-scout can answer “what’s happening in rust among people I trust” without a Hypercolor indexer.
5. Forking a room is publishing another feed with the same tags and a different reach. Tags cannot be captured.

### What it does not buy

Private membership, encrypted history, or capability-gated admin. Those belong to ADR 0001.

Author-homeserver ban still 404s *that author’s* posts. That is the same property pubky.app already has. It is not a reason to hide public chat in a group tenant that Nexus will drop. If a community wants a host that re-seeds media or pins a starter thread, that host is optional and *also* posts.

### Capability consequence

Composition of writes is blocked at the session, not just at the client. Shipping a public composer requires requesting `/pub/pubky.app/:rw` (or a narrower `/pub/pubky.app/posts/:rw` + `tags/:rw` + `feeds/:rw` + `files/:rw` + `blobs/:rw`) on a **separately explained** grant screen from the Paykit / Hypercolor grant. Do not silently widen `RING_GRANT_CAPABILITIES`. Do not request follows-write unless the user is explicitly publishing a follow — and this ADR does not ask them to.

Read-only rooms (hot tags, search-by-tag, username search) need no new grant. They are ordinary GETs to Nexus (and unauthenticated `publicGet` of public homeserver paths).

### Mute caveat

Specs have `PubkyAppMute` at `/pub/pubky.app/mutes/:user_id`. This Nexus watcher ignores mute PUTs (`events/mod.rs` lines 67–68, 122). Scout still lists `MUTED`. Until that is reconciled against production Neo4j and `synonymdev/pubky-nexus`, treat mute as a homeserver-local primitive Hypercolor can read directly, not as a Nexus feature. Do not depend on mute-via-Nexus for room filtering.

## UX

- **Directory:** hot tags for `reach=wot` if the user opted into graph features, else `reach=all` with a warning that it is the global index. Off unless the user opens Channels / Discover.
- **Room:** timeline of posts matching the label (`search_posts_by_tag_handler` and/or `PostStreamQuery.tags`). Composer disabled until the pubky.app grant exists, with copy: “Posting here publishes to the public graph.”
- **Thread:** `parent` URI. Reuse existing reply chrome over post URIs.
- **Join:** there is no membership. Opening the view is a read. Posting is a public write. Saving the feed is a public “I subscribe to this query.”
- **Invite:** `pubky://` of the feed, or `hypercolor://room?tag=rust`. Stop minting `hypercolor://join-public?channel={host}:{uuid}` as the primary path. Keep as a redirect only if mobile already shipped invites (ADR 0001 open question 5).
- **Do not** auto-join tag channels from DM history. **Do not** tag the user’s *profile* with room labels unless they opt in (a user-tag `rust` is a standing interest claim; a post-tag is per-utterance).
- **Do not** run this pipeline on DM text.

`TrustEngine` remains sort-only (`src/services/TrustEngine.ts`). Public tags on a *request row* are presentation with provenance (“12 people tagged `troll`; 2 are in your WoT”), never auto-accept. A colluding cluster can tag each other `trusted`. Mixing those tags into `classifyInboundPeer` would let them slide past the gate. That is a bad design.

## Privacy analysis

Every proposed use of the public graph, with who sees what. A design that maximises graph power while quietly deanonymising a chat user is called out in place.

### A. Derive contacts from follows

| Visible | To whom |
|---|---|
| The follow document `{ created_at }` at `/pub/pubky.app/follows/:peer` | Anyone who lists the user’s `/pub/pubky.app/follows/` (world). Nexus already indexes it into `FOLLOWS`. |
| That Hypercolor *read* the list | If via Nexus: the indexer sees `GET /v0/user/{self}/following` (IP, time, user id). If via homeserver `list` of own `/pub/pubky.app/follows/`: the homeserver already hosts it; no new social fact. Listing own follows may need a `/pub/pubky.app/:r` grant — current session is scoped to `/pub/paykit/` and `/pub/hypercolor.app/v1/` (open question). |
| That the user then opened a DM | Not published, unless they also write a follow. |

**Policy: derived-but-private, opt-in import. Default off.** Reading *own* follows to set `isFollowing` does not publish a new contact list; the list is already public if they use pubky.app. Do **not** write a follow when the user taps “Add contact.” Do **not** treat Hypercolor’s local contact table as synonymous with follows. Copy in one direction, behind a toggle: “Use my pubky.app follows to recognise people.”

A design that makes “Enable Messaging” also publish the address book as follows is a bad design. Signal’s list is not world-readable; `/pub/pubky.app/follows/` is.

`isFollower` alone stays a request. Do not add strangers who merely follow the user to the contact list.

Once imported, `isFollowing` / `isMutual` will auto-accept inbound Encrypted Links (`wotGate`). That is the documented intent of those bits — but only after the user opted in. Shipping the import without the toggle would turn a public social graph into a silent DM allow-list. That is a bad design.

### B. Tag-anchored public channels

| Visible | To whom |
|---|---|
| Each message (a post) | World, and Nexus, and scout. Body is plaintext. |
| Each tag `{ uri, label }` | World. Label is the topic; `uri` is the post (or the user). |
| That the user posted under `rust` | Anyone, forever. Interest and likely membership are public. That *is* what a public channel is. |
| A feed named “Rust chat” | World (the feed JSON). Membership is not listed; *interest in that query* is. |
| Querying `?tags=rust` or `/search/posts/by_tag/rust` | Nexus sees path + query. If `viewer_id` / `observer_id` is sent, Nexus sees who asked. |

**Policy: public, labeled as public, no silent default.** Entering a tag-channel is a publish (when composing) or a public read (when browsing). The UI must say so. Do not auto-join from DM history. Do not tag the user’s profile with room labels unless they opt in.

If Hypercolor wants “public-looking but unlisted” rooms, that is not a tag and not a post. That is a private group-pubky (ADR 0001) with a capability and no public tag. Do not fake it with a tag and hope nobody queries Nexus. That is a bad design.

### C. Nexus queries for discovery

| Visible | To whom |
|---|---|
| Path + query (`/v0/search/posts/by_tag/rust`, `viewer_id`, `observer_id`, `depth`, username prefix) | The Nexus operator (IP, time, what you looked for). |
| Response bodies | Already public data. |

**Policy: opt-in per session or per surface.** Discovery tab may query. Private thread view must not send the peer list or a `channel_id` to Nexus. Do not put `viewer_id` on queries that are only for a local sort. Prefer querying *self* following over querying arbitrary third parties when hydrating the contact book.

A design that hydrates every inbox row by asking Nexus “who is this?” tells the indexer who is trying to message you. That is a bad design.

### D. nexus-scout Cypher

| Visible | To whom |
|---|---|
| The Cypher text and `params` (including pubky ids you are investigating) | The scout operator, in server logs by necessity of running the query. GET-with-query-string also leaks via URL logs and intermediaries. |
| That you asked about follow-distance(A,B) | Stronger signal than a REST list fetch. |

**Policy: opt-in, POST only, never from the private inbox.** Show the Cypher. Treat results as claims. Default off. This is closer to “I asked a search engine about these people” than to a local index.

A design that auto-scouts every inbound request sender is a bad design: it tells a third party who is trying to message you. DMs are unmodeled; asking would only leak intent.

Building a Hypercolor-specific AI over `/pub/hypercolor.app/v1/public-channels/` would be a worse scout over a smaller, invisible graph. Do not do that.

### E. TrustEngine + graph signals

| Visible | To whom |
|---|---|
| Nothing new if scores stay local | — |
| If auto-accept reads public tags | The accept decision becomes a function of a world-writable WoT |

**Policy:** public tags are labels on the request UI, with provenance. They are not a delivery control. `TrustEngine` stays sort-only.

### F. Username search on Add Contact

| Visible | To whom |
|---|---|
| `GET /v0/search/users/by_name/{prefix}` | Nexus sees the prefix, IP, time. |
| Selecting a result and adding locally | Not a public write. Same as today’s paste path after the lookup. |

**Policy:** allowed on the Add Contact surface. Do not search-as-you-type from a private thread composer. Do not write a follow on select.

### G. Public compose (post + tag + optional feed)

| Visible | To whom |
|---|---|
| Post body, parent URI, attachments | World. Forever, until the author deletes the homeserver object (Nexus may retain an index row until the watcher handles DEL). |
| Tag label + post URI | World. Standing evidence of interest in that label. |
| Feed JSON | World. Evidence of subscription to that query. |
| The `/pub/pubky.app/` grant itself | The authenticator and the homeserver see the capability string. Not a social fact. |

**Policy:** grant screen and composer both say this is a public publish. No silent dual-write to a Hypercolor path. No tagging of DM counterparts.

### H. Optional public host (group-pubky as operator)

| Visible | To whom |
|---|---|
| Host’s own posts/tags | World, as G. |
| Group tenant ciphertext / prefixes | World can see the tenant exists and who has a write prefix (ADR 0001 P-B leak). |

**Policy:** only if the host *also* emits posts. A host-only log is the rejected namespace. Do not tag the host “members” as a roster.

## What Hypercolor stops doing

- Stop treating `PublicChannelMeta` as a product schema.
- Stop telling implementers “Nexus does not index chat URIs” as if that were a constraint rather than a self-inflicted namespace choice (`src/types/group.ts` public-channel comments).
- Stop shipping a Channels page that can only create private pairwise groups (`src/components/channels-page.tsx` + `GroupService.createChannel`) while the word “channel” in the types file means something else.
- Stop inventing a third object when a post plus a tag plus a feed already exist.

## Reconciliation with ADR 0001

```
                    public graph (posts, tags, follows, feeds)
                    ─────────────────────────────────────────
  discovery  →  tag label + feed          moderation → tags, mutes, reach
  utterance  →  PubkyAppPost              scout / Nexus → accelerator

                    private / hosted
                    ─────────────────────────────────────────
  DM         →  Encrypted Link PAM        (already shipped)
  private
  group      →  group-as-pubky + caps
               + signed DAG + local index (ADR 0001)
```

**No conflict** on capabilities, signed DAGs, content-addressed private attachments, “Nexus is untrusted,” or “revocation is unavailable in v1.”

**Resolved conflict:** public utterances that live only on a group-pubky homeserver tree are `Resource::Unknown`. ADR 0001 is amended: group-as-pubky is private-only; this ADR owns public rooms.

**Soft conflict, same resolution:** ADR 0001’s local indexer must not ingest `/pub/pubky.app/follows/` into a mandatory Hypercolor roster. Same opt-in as §A.

Hypercolor’s `ParsedCapability { scope, read, write }` (`src/lib/capabilities.ts`) is the same shape ADR 0001 wants for a group-pubky scope. Extending it to `/pub/pubky.app/` is composition. Using it to hide public posts under `/pub/hypercolor.app/v1/` is not.

## Alternatives considered

### Keep `/pub/hypercolor.app/v1/public-channels/` because the Ring grant already covers it

**Pros:** No new grant screen; types already exist; mobile pin may have written objects (open question).

**Cons:** Invisible to Nexus, scout, pubky.app, hot tags, search-by-tag. Web never implemented the reader. Ban-erasure is the same as posts (author-sharded). The grant is a product decision, not a graph constraint.

**Why not chosen:** Self-inflicted invisibility. The grant screen is cheaper than a parallel social object.

### Put public messages on a group-as-pubky tenant (original ADR 0001 Phase 3)

**Pros:** Mailbox-replaceable host; member mirrors survive an author homeserver ban.

**Cons:** `Resource::Unknown`. Rebuild discovery, hot rooms, WoT filters, and scout recipes for one app. Forkability of a host is not discoverability of a topic.

**Why not chosen:** Optional host may exist *in addition* to posts. It must not replace them.

### Treat a public channel as only a tag, no feed

**Pros:** Smallest write; enough to browse.

**Cons:** No named, revisitable, shareable room object; no reach/sort/layout.

**Why not chosen as the end state.** Allowed as the first *read* increment (ADR 0003 item 2). Feeds come after compose.

### Use nexus-scout as the rooms directory

**Pros:** Richer questions than REST.

**Cons:** Intent leak to a third operator; Cypher in the product; not needed for “hot tags” / “posts by tag,” which already exist as REST.

**Why not chosen as the default path.** Opt-in box on discovery only.

### Write a follow when the user adds a contact

**Pros:** Graph stays symmetric with pubky.app.

**Cons:** Publishes the messenger’s address book. `/pub/pubky.app/follows/` is world-readable.

**Why not chosen.** That is a bad design.

## Consequences

### Positive

- Public rooms exist the day we point a view at APIs that already have data.
- WoT, tags, and feeds compose with every other pubky.app consumer.
- Private messaging is not forced through an indexer that cannot model DMs.
- The Ring grant stays honest: Paykit + Hypercolor owner writes are not silently a social publish.

### Negative

- Public compose waits on a new grant and on user understanding that posting is public.
- Author ban still erases that author’s posts from the live graph (same as pubky.app).
- Nexus/scout operators see discovery queries.
- Mute-via-Nexus is unreliable in this fork.
- If mobile already wrote `public-channels/`, those objects remain unindexed until an importer exists (open question).

### Neutral

- Private attachments and backups stay under `/pub/hypercolor.app/v1/`. They are not graph fragmentation; they are app-private ciphertext.

## Open questions

1. **Did mobile Hypercolor (`c7157aaa`) ever write `public-channels/` or a follows import?** This web tree is a pin of those types plus a web `GroupService` that rejects public channels. Resolve: grep the mobile repo. If yes, need a read-only importer or a redirect, not a silent drop.
2. **Does production Nexus still have `MUTED` edges?** Watcher in this fork ignores mute PUTs; scout documents them. Resolve: scout `MATCH ()-[m:MUTED]->() RETURN count(m)` and compare `synonymdev/pubky-nexus` watcher.
3. **Does pubky-app’s muted helper hit a live route on `nexus.pubky.app`?** This fork’s `endpoints.rs` user block has followers/following/friends/tags/notifications — no muted route. Resolve: hit production swagger or `GET /v0/user/{id}/muted`.
4. **Homeserver list of own `/pub/pubky.app/follows/` without Nexus.** Current grant is `/pub/paykit/` + `/pub/hypercolor.app/v1/`. Unauthenticated `publicGet` of *another* user’s follows works (GET `/pub/` is open, `authz.rs`). Listing *own* follows via the *session* `list` may still be denied if the client only uses the scoped session for authenticated calls. Resolve: try `session.list('/pub/pubky.app/follows/')` on a current grant; if denied, item 1 uses Nexus for self-following (§A: indexer sees the GET) or we request `/pub/pubky.app/:r` without write.
5. **Exact invite objects already in the world.** If any `hypercolor://join-public?channel=` links shipped, keep a redirect. Resolve: search mobile + any published docs, not this unused web schema.

## Related decisions

- [ADR 0001](0001-group-as-pubky.md) — private group-as-pubky; namespace table; revocation unavailable in v1.
- [ADR 0003](0003-chat-architecture-roadmap.md) — unified roadmap. Items 1–3 of that document are this ADR’s first increments and must not wait on ADR 0001 protocol work.

## References

- `pubky-app-specs`: `src/models/post/mod.rs` `PubkyAppPost`; `src/models/tag.rs` `PubkyAppTag`; `src/models/feed.rs` `PubkyAppFeedConfig`; `src/models/follow.rs` `PubkyAppFollow`; `src/models/user.rs` `PubkyAppUser`; `src/models/file.rs` `PATH_SEGMENT`; `src/uri/resource.rs` `Resource`
- `pubky-nexus`: `nexus-webapi/src/routes/v0/endpoints.rs`; `search/posts.rs` `search_posts_by_tag_handler`; `search/users.rs`; `stream/posts.rs` `PostStreamQuery`; `tag/global.rs` `hot_tags_handler`; `nexus-common/src/types/mod.rs` `StreamReach`; `nexus-watcher/src/events/mod.rs`
- Hypercolor (this tree): `src/types/{link,group,index,attachment}.ts`; `src/lib/{capabilities,contacts-sort}.ts`; `src/services/{NexusClient,StorageService,TrustEngine,contacts/addManualContact,group/GroupService,link/wotGate}.ts`; `src/flags/config.ts`
- nexus-scout: `https://nexus-scout.pubky.app/llms.txt` (2026-08-31)
- `pubky-core` `/pub/` write rule: `pubky-homeserver/src/client_server/layers/authz.rs` `authorize`
