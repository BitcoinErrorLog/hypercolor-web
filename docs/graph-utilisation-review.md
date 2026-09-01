# Graph utilisation review

**Role**: Supporting analysis for the chat-architecture synthesis. Not an ADR. Decisions landed in [`docs/adr/0001-group-as-pubky.md`](adr/0001-group-as-pubky.md), [`docs/adr/0002-public-chat-as-graph.md`](adr/0002-public-chat-as-graph.md), and [`docs/adr/0003-chat-architecture-roadmap.md`](adr/0003-chat-architecture-roadmap.md).

**Carried from**: `hypercolor-web-graph` branch `docs/graph-utilisation-review` at `5ceff67`, written against `origin/main` (`93f0ea1`). Body below is that review. Open question 4 (ADR text unread) is resolved: the conflict it flagged is real, and 0001 is amended so group-as-pubky is private-only.

---

# Graph utilisation review (original)

**Date**: 2026-08-31
**Tree**: `/Volumes/vibedrive/vibes-dev/hypercolor-web-graph` at `origin/main` (`93f0ea1`) plus this document
**Scope**: How Hypercolor uses — or fails to use — the shared Pubky graph (pubky-app-specs, Nexus, tags, curation), and whether chat should be a view over that graph rather than a parallel domain.

This is analysis and design. No protocol or product code was changed.

---

## Framing thesis

> Chat is a UX perspective change over the same graph pubky.app already uses, not a separate application domain.

**Verdict on the thesis**: it holds for *public* surfaces and for *discovery / trust / moderation*. It does **not** hold for private DMs or private groups.

Evidence that public chat is already a graph view:

- A public utterance is a `PubkyAppPost` at `/pub/pubky.app/posts/:post_id` with optional `parent` for threading (`pubky-app-specs/src/models/post/mod.rs` `PubkyAppPost`, lines 126–150).
- A topic label is a `PubkyAppTag` (`uri` + `label`) at `/pub/pubky.app/tags/:tag_id` (`pubky-app-specs/src/models/tag.rs` `PubkyAppTag`, lines 18–36). Tags are claims, not rooms: the label lives on the relationship, not on a `(:Tag)` node (nexus-scout `/llms.txt`, “Tags are not nodes”).
- A saved room-shaped query is a `PubkyAppFeed` at `/pub/pubky.app/feeds/:feed_id` whose config is `{tags, reach, layout, sort, content}` (`pubky-app-specs/src/models/feed.rs` `PubkyAppFeedConfig`, lines 55–73; `HasIdPath` at lines 252–257).
- Nexus already streams and searches that combination: `GET /v0/stream/posts?tags=…&source=…` (`nexus-webapi/src/routes/v0/stream/posts.rs` `PostStreamQuery`, lines 20–34 and 80–113) and `GET /v0/search/posts/by_tag/{tag}` (`nexus-webapi/src/routes/v0/search/posts.rs` `search_posts_by_tag_handler`, lines 19–59).

Evidence that private chat is *not* that graph:

- Encrypted Link DMs are `chat.message.v0` over Paykit Noise, with decode compatibility for `pubky_app.dm.v0` (`hypercolor-web-graph/src/types/link.ts` lines 8–25, 74–80). They never become posts.
- Private groups are pairwise PAM fan-out of `chat.group.*.v0` (`hypercolor-web-graph/src/types/group.ts` lines 11–25, 77–90). There is no shared group key and no homeserver transcript.
- nexus-scout’s own schema says direct messages, reactions, and per-item privacy flags are **not modeled** (`https://nexus-scout.pubky.app/llms.txt`, “Not modeled”).

So: a public channel *should* compose posts + tags + feeds. A private conversation *must not*. Treating those as one domain is how you deanonymise a messenger.

---

## 1. Schema duplication

Hypercolor’s Ring grant covers only `/pub/paykit/:rw` and `/pub/hypercolor.app/v1/:rw` (`src/types/link.ts` `PAYKIT_MESSAGING_CAPABILITY`, `HYPERCOLOR_WRITE_CAPABILITY`, `RING_GRANT_CAPABILITIES`, lines 35–45; `src/lib/capabilities.ts` `HYPERCOLOR_WRITE_SCOPE`, line 10). It does **not** request `/pub/pubky.app/`. That is a capability-level decision to stay off the shared graph, not an accident of one service file.

Every `/pub/hypercolor.app/...` path found in this tree:

### 1.1 `/pub/hypercolor.app/v1/attachments/{uuid}` (+ `.thumb`)

**Hypercolor schema** (`src/types/attachment.ts`):

```
location: pubky://{owner}/pub/hypercolor.app/v1/attachments/{uuid}
wire: chat.attachment.v0 {
  location, key, nonce, algorithm: XChaCha20Poly1305,
  contentType, size, channel_id?, thumbnail?
}
```

Path builder: `buildAttachmentLocation` (lines 141–151). PUT: `src/services/attachments/homeserver.ts` `attachmentHomeserverTarget` (lines 20–44). Ciphertext is world-readable `/pub`; the key travels only on the Encrypted Link (`attachment.ts` lines 6–14).

**Specs equivalent** — `PubkyAppFile` at `/pub/pubky.app/files/:file_id` (`file.rs` `PATH_SEGMENT = "files/"`, line 108) plus `PubkyAppBlob` at `/pub/pubky.app/blobs/:blob_id`:

```
PubkyAppFile { name, created_at, src, content_type, size }
```

(`SPEC.md` PubkyAppFile; `file.rs` lines 45–50.)

**Reuse?** Not for private attachments. Specs files are *plaintext* metadata pointing at a *plaintext* blob. Hypercolor attachments are ciphertext whose AAD is the location. Mapping them onto `PubkyAppFile` would either publish plaintext or publish a file record that Nexus treats as a normal social attachment (watcher `handlers/file.rs` indexes `PubkyAppFile`). That is a different object.

Reuse *is* possible for **public-channel** media: those should be `PubkyAppFile` + `PubkyAppPost.attachments`, which Nexus already serves (`FILE_LIST_ROUTE` / `FILE_ROUTE` in `nexus-webapi/src/routes/v0/endpoints.rs` lines 81–84). Hypercolor does not do this.

### 1.2 `/pub/hypercolor.app/v1/backup/latest`

**Hypercolor**: encrypted owner snapshot. Path constant `BACKUP_PATH` in `src/services/backup/homeserver.ts` line 11. AAD is the `pubky://{owner}/…/backup/latest` URL (`src/services/backup/crypto.ts` comments at lines 14 and 33).

**Specs equivalent**: none. `PubkyAppLastRead` (`/pub/pubky.app/last_read`) is a notification cursor, not a backup. Feeds/bookmarks are public social objects.

**Reuse?** No. A backup is app-private state. Putting ciphertext on `/pub` is a hosting choice (world can see *that* a backup exists and its size; not the contents, if the AEAD holds). It does not fragment the social graph. Keep it.

### 1.3 `/pub/hypercolor.app/v1/public-channels/{host}/{localId}/meta.json`

**Hypercolor** (`src/types/group.ts` lines 66–74, 112–127, 294–300):

```
PublicChannelMeta {
  version: 1,
  channel_id,   // "{hostPubky}:{uuid}"
  name,
  created_by,
  created_at
}
```

Discovery is explicitly “invite links … and known channel ids — **not tags**” (lines 73–74). Nexus “does not index chat URIs today” (line 73; restated 124–125).

**Specs equivalents** (all exist; any one of them is closer than a new namespace):

| Role | Specs object | Path |
| --- | --- | --- |
| Room identity / saved query | `PubkyAppFeed` `{ name, feed: { tags, reach, layout, sort } }` | `/pub/pubky.app/feeds/:feed_id` |
| Topic key | `PubkyAppTag.label` | `/pub/pubky.app/tags/:tag_id` |
| Pinned index (≤100 URIs) | `PubkyAppPost` `kind = collection` | `/pub/pubky.app/posts/:post_id` |

A collection cannot *be* the message log (max 100 items, `SPEC.md` collection envelope). A feed *is* the room object: a named, hash-identified query over tags + reach.

**Reuse?** Yes. `PublicChannelMeta` is a weaker `PubkyAppFeed` that Nexus cannot see. `Resource` in specs has no Hypercolor variant (`pubky-app-specs/src/uri/resource.rs` lines 11–27: `Unknown` is the default). Watcher PUT handling matches only `PubkyAppObject` variants and otherwise logs “Event type not handled” (`nexus-watcher/src/events/mod.rs` lines 57–106). A public-channel PUT is `Resource::Unknown` and is dropped.

This tree does **not** even implement the reader. `GroupService` states “Public channels are out of scope on web” (`src/services/group/GroupService.ts` lines 34–35) and throws `private-only` on public channels (line 370–372). The parallel schema is invented, documented as not-tags, and unused on web.

### 1.4 `/pub/hypercolor.app/v1/public-channels/{host}/{localId}/messages/{sentAt}-{eventId}.json`

**Hypercolor** (`group.ts` `PublicChannelMessageDocument`, lines 302–312, 821–854):

```
{
  version: 1,
  kind: "chat.public.message.v0",
  channel_id, event_id, sent_at, body, author,
  reply_to?, reply_to_author?
}
```

Authorship is the path owner (`decodePublicChannelMessage` rejects `author !== pathOwner`, lines 834–835). Readers “list+get the host plus any locally-known authors” (lines 123–124). There is no global index.

**Specs equivalent** — `PubkyAppPost`:

```
{
  content,                    // body
  kind: "short",              // or long
  parent,                     // reply thread
  embed?, attachments?, lock?
}
```

(`post/mod.rs` lines 136–150.) Threading is `parent: Option<String>` (URI of parent post). Nexus already has `source=post_replies` (`stream/posts.rs` lines 107–109) and scout has `REPLIED` paths.

**Reuse?** Yes, and it is the high-value duplication. A public message that is *not* a post is invisible to:

- `GET /v0/search/posts/by_tag/{tag}`
- `GET /v0/stream/posts?tags=`
- hot tags / WoT taggers
- pubky.app’s home feed
- nexus-scout Cypher

That is exactly the fragmentation the thesis warns about.

### 1.5 `/pub/hypercolor.app/v1/e2e/owner-roundtrip.json`

Test-only (`src/services/link/ownerRoundtrip.ts` `OWNER_ROUNDTRIP_PATH`, lines 7–8). Not a product schema.

### 1.6 Wire kinds that are not homeserver paths

These are Encrypted Link PAMs, not `/pub` objects. They have **no** specs equivalent and should not:

| Kind | File | Why it is not a post |
| --- | --- | --- |
| `chat.message.v0` / `pubky_app.dm.v0` | `types/link.ts` 74–80 | Private Noise payload |
| `chat.group.message/reaction/edit/delete/membership.v0` | `types/group.ts` 77–81 | Private fan-out |
| `chat.attachment.v0` | `types/attachment.ts` 15 | Carries the AEAD key |

Inventing these is not graph fragmentation. Putting *public* chat in the same style of custom JSON *is*.

### 1.7 Capability consequence

Because the Ring grant is `/pub/hypercolor.app/v1/:rw` only, Hypercolor **cannot** write follows, tags, posts, or feeds without a new grant for `/pub/pubky.app/`. Composition is blocked at the session, not just at the client.

---

## 2. Follows graph

`ContactSource` is `'follow' | 'manual' | 'mesh'` (`src/types/index.ts` line 26). The comment on `Contact.isFollowing` claims homeserver `/pub/pubky.app/follows/` **or** Nexus following (lines 36–41). Schema v5 says relationship flags exist “so Nexus + homeserver follows can merge independently” (`src/db/schema.ts` lines 500–507). `PROFILE_HYDRATE_CONCURRENCY` is documented as “hydrating pubky.app profiles during follows import” (`src/flags/config.ts` lines 33–34). `setContactRelationshipFlags` is documented as the “authoritative flag write — used when Nexus following is a complete 200” (`src/services/StorageService.ts` lines 161–164).

**None of that is wired.**

| Symbol | Callers in this tree (excluding definitions / vendor pin) |
| --- | --- |
| `ContactSource` | Type only. Not a field on `Contact`. |
| `NexusClient.followers` / `.following` / `.friends` | Defined in `NexusClient.ts` 147–155. **No production caller.** |
| `StorageService.setContactRelationshipFlags` | Defined at 165–184. **No caller.** |
| `PROFILE_HYDRATE_CONCURRENCY` | Defined. **No reader.** |
| Write to `/pub/pubky.app/follows/` | **Zero matches** under `src/` except the comment on `Contact.isFollowing`. |

What *does* run:

- `addManualContact` (`src/services/contacts/addManualContact.ts` 10–56) pastes/scans a pubky, optionally GETs `nexus.user()` for `details.name` (lines 30–35), and upserts with `addedManually: true` while **preserving** existing follow flags (lines 42–45) — it never sets them from the graph.
- Contacts UI (`src/components/contacts-page.tsx` 32–45) lists `StorageService.getAllContacts`. No import.
- `upsertContact` ORs flags with `MAX(...)` (`StorageService.ts` 96–98) so a follow bit, if it ever arrived, would stick — but nothing writes a true bit except a backup restore of a row that already had one.

**Does a pubky.app follow show up as a Hypercolor contact?** No.

**Does adding a Hypercolor contact write a follow?** No. The grant could not PUT `/pub/pubky.app/follows/:id` anyway.

**What pubky.app actually writes**, for contrast: `UserController.commitFollow` normalizes via `FollowNormalizer.to` → `builder.createFollow` and PUTs `{ created_at }` to `meta.url` under `/pub/pubky.app/follows/` (`pubky-app/src/core/controllers/user/user.ts` 155–171; `follow.normalizer.ts` 8–15; specs `PubkyAppFollow` `{ created_at }` at `follow.rs` 16–31, path `/pub/pubky.app/follows/:user_id`).

Hypercolor keeps a **private parallel contact list**. `ContactSource = 'follow'` is aspirational documentation.

`mesh` is equally dead on web (README: “BLE mesh is omitted”).

---

## 3. Tags and curation

**Are tags used at all today?** No, as social primitives.

Grep of `src/` for tag/curation language hits:

- AEAD authentication tags (`flags/config.ts` 68–81; `attachments/xchacha.ts`)
- bolt11 `tag?: string`
- Paykit wasm `{ tag: "public-client" }` in a test
- The explicit disclaimer that public-channel discovery is “**not tags**” (`types/group.ts` 73–74)

Zero reads or writes of `/pub/pubky.app/tags/`. Zero Nexus tag/hot/search-by-tag calls. Zero bookmarks. Zero feeds. Zero mutes.

pubky.app’s mature consumer does the opposite:

- `TagController.commitCreate` → `TagApplication.commitCreate` PUTs tag JSON to the homeserver (`pubky-app/src/core/controllers/tag/tag.ts` 13–16; `application/tag/tag.ts` 17–35).
- `FeedApplication.persist` writes `/pub/pubky.app/feeds/:id` and treats the HashId as the identity of a `{tags, reach, sort, content, layout}` query (`application/feed/feed.ts` 25–76).
- Nexus clients exist for hot tags, taggers, post streams by tag, user search (`pubky-app/src/core/services/nexus/{tag,hot,search,stream}`).

### How tag-anchored discovery would work

A tag is a **claim**: one key, one URI, one label (`PubkyAppTag` `{ uri, label, created_at }`). It is not a membership list and not a room ACL.

| UX idea | Graph composition | Already queryable |
| --- | --- | --- |
| Topic channel `#rust` | Posts (and/or people) tagged `rust` | `GET /v0/search/posts/by_tag/rust`; `GET /v0/stream/posts?tags=rust` |
| Chat category / “rooms directory” | Hot labels in a reach | `GET /v0/tags/hot?user_id=&reach=wot` (`tag/global.rs` 84–102) |
| Curated room | A `PubkyAppFeed` named e.g. “Rust chat” with `feed.tags = ["rust"]` and `reach` | Homeserver feed + Nexus stream with the same params |
| People worth talking to | Users tagged `rust` / `pubky` / `helpful`, filtered by follow distance | `GET /v0/user/{id}/tags`, `GET /v0/tags/taggers/{label}?reach=wot`; scout `TAGGED` + `FOLLOWS*..5` |
| “This person is a bot / verified-human” | User-targeted tags (the John Cardano example) | `GET /v0/user/{id}/tags?viewer_id=&depth=` (`tests/tags/wot.rs` 32–42) |
| Pin a starter thread | Collection post, or bookmark the root post | `PubkyAppBookmark`; `stream/posts?source=bookmarks` |

### Should a public channel simply be a tag?

**Almost, with one refinement.**

- The *discovery key* is a tag label. That is what Nexus and scout aggregate. That is what other apps already publish into. That is what you get for free.
- The *room object* (a named, revisitable, shareable view with a layout and a reach) is a **feed**, not a tag. A tag has no name, no reach, no sort, no owner beyond each claimant. A feed does (`PubkyAppFeed.name` + `PubkyAppFeedConfig`).
- The *message* is a post, optionally with `parent`. Not `chat.public.message.v0`.

Saying “the channel is a tag” is the right slogan for discovery. Implementing only a tag with no feed is enough to *browse*. Implementing a feed is enough to *subscribe*. Neither needs `/pub/hypercolor.app/v1/public-channels/`.

What that buys:

1. Every pubky.app user who already tags `rust` is already in the channel.
2. WoT-filtered hot tags become the rooms directory (`StreamReach::Wot`, `nexus-common/src/types/mod.rs` lines 23–29).
3. Moderation is the same mute/tag/reach policy as the social app, not a Hypercolor-only block list.
4. nexus-scout can answer “what’s happening in rust among people I trust” without a Hypercolor indexer.
5. Forking a room is publishing another feed with the same tags and a different reach — no admin capture of the label itself (tags are unownable; that is the specs design).

What it does **not** buy: private membership, encrypted history, or capability-gated admin. Those belong to group-as-pubky (section 8).

---

## 4. Nexus utilisation

Hypercolor’s client (`src/services/NexusClient.ts`) wraps four GETs and documents them as the only allowed use (lines 6–17):

```
GET /v0/user/{id}/followers
GET /v0/user/{id}/following
GET /v0/user/{id}/friends
GET /v0/user/{id}            → UserView
```

Production call sites: **`nexus.user()` only**, from `addManualContact.ts` 30–35, to copy a display name. Followers/following/friends are unused. `NexusClient` is copied from mobile pin `c7157aaa` (file header line 2) and has not grown.

Nexus actually exposes, in this workspace’s `endpoints.rs` (lines 6–94), roughly fifty `/v0` routes across users, posts, streams, search, tags, files, notifications, bootstrap, events, and marketplace. pubky-app consumes a large slice of those (`user.api.ts` 10–80: view, counts, details, followers, following, friends, muted, notifications, relationship, tags, taggers; `search.api.ts` 10–43; `postStream.api.ts` 32–60; `tag.api.ts` 11–26; `NexusHotService.fetch`).

**Fraction Hypercolor uses**: 1 live call / 4 wrapped / ~50 served. Call it ~2% of the REST surface, 0% of streams, 0% of tags, 0% of search, 0% of WoT.

High-value queries left on the table (concrete, already implemented):

| Capability | Route | Why it matters for a messenger |
| --- | --- | --- |
| Own following list | `GET /v0/user/{id}/following` | Make `isFollowing` real; WoT auto-accept starts matching intent |
| Followers / friends | `…/followers`, `…/friends` | Badge + sort already exist (`contacts-sort.ts` 5–22) but the bits are always false |
| Pairwise relationship | `GET /v0/user/{id}/relationship/{viewer}` | One round-trip instead of two list scans |
| Tag rooms | `GET /v0/search/posts/by_tag/{tag}` | Public channel timeline without a new namespace |
| Tagged stream + reach | `GET /v0/stream/posts?tags=&source=following\|friends&observer_id=` | “Friends talking about X” |
| Hot tags / rooms directory | `GET /v0/tags/hot?reach=wot&user_id=` | Discover channels from the graph |
| Taggers of a label | `GET /v0/tags/taggers/{label}?reach=wot` | People worth inviting |
| User tags (reputation) | `GET /v0/user/{id}/tags?viewer_id=&depth=` | Trust signal beyond local score (`tests/tags/wot.rs`) |
| Recommended / influencers | `GET /v0/stream/users?source=recommended\|influencers` | “Who should I talk to” |
| Username / pubky search | `GET /v0/search/users/by_name/{prefix}`, `…/by_id/{prefix}` | Contact add without paste-only |
| Notifications | `GET /v0/user/{id}/notifications` | Follows, tags, replies as inbound social events |
| Bootstrap | `GET /v0/bootstrap/{user_id}` | Hydrate graph neighbourhood after enable |
| Events (local indexer) | `GET /v0/events` | Treat Nexus as an untrusted accelerator, per the group-as-pubky ADR |
| Files | `GET /v0/files/…` | Public attachments that are already posts |

Marketplace streams are low value for chat. Mute is an open question: pubky-app’s `user.api.ts` has a `muted` helper (lines 47–54) but this Nexus tree’s `user/mod.rs` (lines 18–32) does **not** register a muted route, and the watcher no longer applies mute PUTs (`events/mod.rs` 67–68, 122). scout still lists `MUTED`. Do not depend on mute-via-Nexus until that is reconciled.

---

## 5. nexus-scout

**It is not in `pubky-nexus`.** This workspace’s Nexus tree has no `scout` crate, route, or doc hit. The product lives at:

- Gateway: `https://nexus-scout.pubky.app`
- Agent skill (byte copy of the gateway’s `/llms.txt`): `https://github.com/pubky/agent-skills` → `skills/nexus-scout/SKILL.md`
- Upstream repo (not cloned here): `https://github.com/pubky/nexus-scout`

**What it actually is**: a public, read-only Cypher HTTP gateway over the same Neo4j social graph Nexus indexes. One endpoint, `POST|GET /v1/query`, plus `GET /v1/schema`. No account, no API key. A sanitizer rejects writes, `CALL`, admin clauses, and unbounded paths. Default page 25, hard cap 100 rows, 10s timeout, path depth `*1..5`.

Graph it exposes (from `/llms.txt`, verified 2026-08-31):

| Nodes | Edges |
| --- | --- |
| `User`, `Post`, `File` | `FOLLOWS`, `AUTHORED`, `REPLIED`, `REPOSTED`, `TAGGED` (label on the edge), `BOOKMARKED`, `MENTIONED`, `MUTED` |

Recipes it advertises: find user by name, mutual friends, most-used tags, trending tags, reputation-as-incoming-tags, reply threads, follow-distance `shortestPath`.

John’s article (`Synonym/articles/pubky/nexus-scout-agentic-web.md`) is the product story: give an agent the URL; it learns the schema, writes Cypher, and weighs attributable claims (the John Cardano / `verified-human` example). That article is rhetoric, not an API spec. The API spec is `/llms.txt`.

**Opinion, not a survey.**

Scout is a genuine unlock for *questions about the public graph*. It is a distraction as a *chat transport* or as a substitute for Encrypted Links.

Use it for:

- “Find rooms” = trending `TAGGED` labels in my WoT.
- “Find people” = follow distance + incoming tags + mutuals.
- “What’s the context on this pubky?” = incoming `TAGGED` + follower count + contradictory labels.
- “Summarise this public thread” = `REPLIED*0..5` then local LLM. Scout returns rows; it does not summarise.

Do not use it for:

- Inbox, DM bodies, group membership, attachment keys. Those edges do not exist. Asking would only leak *intent* to the gateway.
- Authoritative moderation. It is one indexer’s Neo4j, rate-limited and capped. The group-as-pubky ADR’s “Nexus is an untrusted accelerator” applies here even more: scout is a *public* query surface on that accelerator.

Product shape if you ship it: an opt-in “Ask the graph” box on the public/discovery surfaces, never on the thread view of a private chat. Default off. Show the Cypher. Treat results as claims.

Building a Hypercolor-specific AI over `/pub/hypercolor.app/v1/public-channels/` would be the distraction — a worse scout over a smaller, invisible graph.

---

## 6. Trust and moderation

`TrustEngine` (`src/services/TrustEngine.ts`) computes a `[0,1]` sort key from:

| Signal | Weight | Source |
| --- | --- | --- |
| Routed message count | 0.01 each, cap 0.4 | local `link_messages` |
| Recency (30 days) | cap 0.25 | `contact.lastInteractionAt` |
| Homeserver resolved | 0.10 | local `homeserver` string |
| Mutual / following / follower | 0.25 / 0.15 / 0.05 | `socialGraphScore`, lines 107–117 |

Comments state the score is **sort-only** and never blocks delivery (lines 6–9). That is correct and should stay.

The inbound gate is `wotGate.ts`. Auto-accept is `isMutual || isFollowing || addedManually || hasEstablishedConversation` (lines 63–70). It deliberately ignores the composite score (lines 17–20). Because follow flags are never populated (section 2), the graph half of the table is dead: a pubky.app friend is a **request**, same as a stranger, unless the user pasted them.

Could the shared graph do this better?

**For private inbound DMs: only as an *opt-in* hint, never as the sole gate.**

- `isFollowing` from a *local read* of the user’s own `/pub/pubky.app/follows/` (or Nexus following of *self*) is a legitimate “I already chose this person in another app” signal. That is the missing wire for the table that `wotGate` already documents.
- Incoming tags (`verified-human`, `spam`, `troll`) and follow-distance are useful *presentation* on the request row. They are not auto-accept. A stranger can acquire tags. A cluster can collude.
- Unilateral `isFollower` is already correctly weak (0.05 sort, never auto-accept). Keep it that way.

**For public channels and discovery: yes, the graph is strictly better, and it is composable.**

pubky.app already filters streams by `StreamReach` (`followers | following | friends | wot | wot_N`). Hot tags take the same reach (`tag/global.rs` 41, 90). User tags take `viewer_id` + `depth` (`tests/tags/wot.rs`). A Hypercolor public-room view that reuses those queries inherits mute/tag/WoT policy from every other consumer. A Hypercolor-only `TrustEngine` on a parallel message log cannot.

**Mute caveat**: specs have `PubkyAppMute` at `/pub/pubky.app/mutes/:user_id` (`mute.rs` 16–28). This Nexus watcher ignores mute events (`events/mod.rs` 67–68). Scout still documents `MUTED`. Open question: is `MUTED` populated on production Neo4j from older data only? Resolve by querying scout `MATCH ()-[m:MUTED]->() RETURN count(m)` and by reading current `synonymdev/pubky-nexus` (this workspace is a marketplace-indexing fork). Until then, treat mute as a homeserver-local primitive Hypercolor can read directly, not as a Nexus feature.

Shared-graph moderation is composable **only on public objects**. Applying it silently to DM routing would make “who I talk to” a function of a public WoT — that is a bad design. See privacy below.

---

## Privacy analysis (not a hand-wave)

Every proposed use of the public graph, with who sees what.

### A. Derive contacts from follows

| Visible | To whom |
| --- | --- |
| The follow document `{ created_at }` at `/pub/pubky.app/follows/:peer` | Anyone who lists the user’s `/pub/pubky.app/follows/` (world). Nexus already indexes it into `FOLLOWS`. |
| That Hypercolor *read* the list | If via Nexus: the indexer sees `GET /v0/user/{self}/following` (IP, time, user id). If via homeserver `list` of own `/pub/pubky.app/follows/`: the homeserver already hosts it; no new social fact. |
| That the user then opened a DM | Not published, unless they also write a follow. |

**Policy**: **derived-but-private, opt-in import.** Default off. Reading *own* follows to set `isFollowing` does not publish a new contact list; the list is already public if they use pubky.app. Do **not** write a follow when the user taps “Add contact”. Do **not** treat Hypercolor’s local contact table as synonymous with follows. Copy in one direction, behind a toggle: “Use my pubky.app follows to recognise people.”

A design that makes “Enable Messaging” also publish the address book as follows is a bad design. Signal’s list is not world-readable; `/pub/pubky.app/follows/` is.

### B. Tag-anchored public channels

| Visible | To whom |
| --- | --- |
| Each message (a post) | World, and Nexus, and scout. Body is plaintext. |
| Each tag `{ uri, label }` | World. Label is the topic; `uri` is the post (or the user). |
| That the user posted under `rust` | Anyone, forever. Interest and likely membership are public. That *is* what a public channel is. |
| A feed named “Rust chat” | World (the feed JSON). Membership is not listed; *interest in that query* is. |
| Querying `?tags=rust&observer_id=me` | Nexus sees observer id + tags. |

**Policy**: **public, labeled as public, no silent default.** Entering a tag-channel is a publish. The UI must say so. Do not auto-join tag channels from DM history. Do not tag the user’s *profile* with room labels unless they opt in (a user-tag `rust` is a standing interest claim; a post-tag is per-utterance).

If Hypercolor wants “public-looking but unlisted” rooms, that is not a tag and not a post. That is a group-pubky with a capability and no public tag. Do not fake it with a tag and hope nobody queries Nexus.

### C. Nexus queries for discovery

| Visible | To whom |
| --- | --- |
| Path + query (`/v0/search/posts/by_tag/rust`, `viewer_id`, `observer_id`, `depth`) | The Nexus operator (IP, time, what you looked for). |
| Response bodies | Already public data. |

**Policy**: **opt-in per session or per surface.** Discovery tab may query. Private thread view must not send the peer list or the channel_id to Nexus. Do not put `viewer_id` on queries that are only for a local sort. Prefer querying *self* following over querying arbitrary third parties when hydrating the contact book.

### D. nexus-scout Cypher

| Visible | To whom |
| --- | --- |
| The Cypher text and `params` (including pubky ids you are investigating) | The scout operator, in server logs by necessity of running the query. GET-with-query-string also leaks via URL logs and intermediaries. |
| That you asked about follow-distance(A,B) | Stronger signal than a REST list fetch. |

**Policy**: **opt-in, POST only, never from the private inbox.** Show the query. This is closer to “I asked a search engine about these people” than to a local index. A design that auto-scouts every inbound request sender is a bad design: it tells a third party who is trying to message you.

### E. TrustEngine + graph signals

Mixing public tags into auto-accept would let a colluding cluster tag each other `trusted` and slide past the gate. **Avoid** as a delivery control. **Allow** as a label on the request UI, with provenance (“12 people tagged `troll`; 2 are in your WoT”).

---

## Verdict

Hypercolor is building a serious encrypted-messaging client (Noise links, pairwise groups, attachment AEAD, owner backup) and a **decorative** relationship to the Pubky graph: types and comments that name follows, Nexus, and tags, with one live `GET /v0/user/{id}` for a display name. It is not doing the most powerful or elegant thing available on the public side. It is quietly specifying a parallel public-channel namespace that Nexus will never index, while the web client does not even implement that namespace.

The elegant split is already in the primitives: **private chat is not a post; public chat is a post plus a tag plus optionally a feed.** Hypercolor has the first half. It is inventing a third thing instead of using the second.

### Gaps ranked by value-to-effort

1. **Opt-in follows import (read-only)** — wire `NexusClient.following` / `.followers` / `.friends` (or list own `/pub/pubky.app/follows/`) into `setContactRelationshipFlags`. Unlocks the WoT table that already exists. No new grant. No public write.
2. **Tag-channel *view*** — a Channels tab that is `GET /v0/search/posts/by_tag/{label}` + `GET /v0/tags/hot`. No Hypercolor path, no protocol work, user-visible rooms from the existing graph.
3. **Username search on Add Contact** — `GET /v0/search/users/by_name/{prefix}`. Stops forcing raw z32 paste.
4. **Request-row graph hints** — `GET /v0/user/{peer}/tags` (and relationship) as labels only.
5. **Ring grant for `/pub/pubky.app/:rw` (or `:r` + write only when posting)** — prerequisite for composing writes. Product decision, not a weekend.
6. **Publish public messages as posts** (and drop `chat.public.message.v0` / `public-channels/`) — the actual de-fragmentation. Needs grant + dual-write if any mobile clients already wrote the old path (open question: mobile pin `c7157aa` types exist; this web tree never writes them).
7. **Saved room = `PubkyAppFeed`** — after 2 and 6, persist a feed instead of `PublicChannelMeta`.
8. **Opt-in scout box** on discovery only.
9. **Local indexer / events cursor** — treat Nexus as accelerator (aligns with group-as-pubky ADR). Larger effort; do not block 1–3.

---

## Proposal: tag-anchored discovery and channels

### Objects

| Layer | Object | Where it lives |
| --- | --- | --- |
| Utterance | `PubkyAppPost` (`kind: short`, `parent` for thread) | `/pub/pubky.app/posts/:id` |
| Topic | `PubkyAppTag` `{ uri: postUri, label }` | `/pub/pubky.app/tags/:hash` |
| Room (saved view) | `PubkyAppFeed` `{ name, feed: { tags: [label], reach, sort, layout } }` | `/pub/pubky.app/feeds/:hash` |
| Optional host identity | group-as-pubky (section 8) | own key / pkarr / capabilities |
| Private group | **not these** | Encrypted Links or group-pubky DAG |

### UX

- **Directory**: hot tags for `reach=wot` if the user opted into graph features, else `reach=all` with a warning that it is the global index.
- **Room**: timeline of posts matching the label; composer publishes a post and a tag in one local-first commit (same pattern as `TagApplication.commitCreate` + post create in pubky-app).
- **Thread**: `parent` URI. Hypercolor already has reply UX for groups; reuse it over post URIs.
- **Join**: there is no membership. Opening the view is a read. Posting is a public write. Saving the feed is a public “I subscribe to this query.”
- **Invite**: `pubky://` of the feed, or `hypercolor://room?tag=rust`. Stop minting `hypercolor://join-public?channel={host}:{uuid}` as the primary path (keep as a redirect if any invites already shipped — open question).

### Privacy (inline)

Covered in §Privacy B and C. Short form: posting is public; tagging the post is public; saving a feed is public interest; querying Nexus reveals the query; do not auto-tag the user; do not run this pipeline on DM text.

### What Hypercolor stops doing

- Stop treating `PublicChannelMeta` as a product schema.
- Stop telling implementers “Nexus does not index chat URIs” as if that were a constraint rather than a self-inflicted namespace choice (`group.ts` 73–74, 124–125).
- Stop shipping a Channels page that can only create private pairwise groups (`channels-page.tsx` + `GroupService.createChannel`) while the word “channel” in the types file means something else.

---

## Reconciliation with the group-as-pubky ADR

The parallel ADR (not read; that worktree is out of bounds) proposes: a group is a first-class pubky (own keypair, pkarr, homeserver), capability-scoped membership via `pubky-common` `Capability { scope, actions }`, a content-addressed signed message DAG, content-addressed attachments, forkability against admin capture, and a local indexer that treats Nexus as an untrusted accelerator.

**Position: complementary, not competing — if and only if “group-as-pubky” is the *private / hosted* object and “channel-as-tag” is the *public / discovered* view.**

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
               + signed DAG + local index (ADR)
```

### Why a public channel should not *be* a group-pubky

A group-pubky’s homeserver space is not in `Resource` and will not be indexed (same drop as today’s `public-channels/`). You would rebuild discovery, hot rooms, WoT filters, and scout recipes for one app. Forkability of a group-pubky solves *admin capture of a host*. It does not solve *discoverability of a topic*. Tags already cannot be captured: there is no `(:Tag)` node to seize (`/llms.txt`).

### Why a private group should not *be* a tag

A tag is world-readable. Membership-as-tag is a public roster. That contradicts encrypted messaging and the ADR’s capability gate. Do not “just tag the group pubky `members`.”

### Where they compose

- A **public community with a host** may have a group-pubky as the *operator* (capabilities for pinned posts, bans-as-mutes, re-seeding media) **and** must still emit member utterances as ordinary posts tagged with the room label. The host key can post as itself; members post as themselves. Nexus sees people, not a walled garden.
- A **private group** is only a group-pubky (or today’s pairwise fan-out until that ships). No tags, no Nexus, no scout.
- **Attachments**: private → content-addressed sealed blobs as the ADR says (Hypercolor’s `/v1/attachments/` is a preview of that, minus content addressing). Public → `PubkyAppFile` / `PubkyAppBlob` so the file graph stays unified.
- **Local indexer**: yes, for the group DAG *and* as a cache of public posts the user actually opened. Nexus/scout remain untrusted accelerators. Hypercolor should not wait for that indexer before shipping gaps 1–3.

### Direct conflicts to flag

1. **If the ADR places public-channel *messages* only in the group-pubky’s homeserver tree** (any path that is not `/pub/pubky.app/posts|tags|feeds`), it conflicts with this review and with Nexus’s `Resource` enum. Say so in the ADR: public utterances must be specs objects or they are invisible.
2. **If the ADR treats “fork the group-pubky” as the discovery/moderation story for public rooms**, it conflicts with tag un-ownability. Fork a *host*; do not expect to fork a *label*. Competing feeds on the same tag is the public equivalent of a fork.
3. **No conflict** on capabilities, signed DAGs, content-addressed private attachments, or “Nexus is untrusted.” Those are the right private-group design.
4. **Soft conflict on contacts**: the ADR’s local indexer must not ingest `/pub/pubky.app/follows/` into a mandatory Hypercolor roster. Same opt-in as §Privacy A.

Hypercolor’s current `Capability` parser (`src/lib/capabilities.ts` `ParsedCapability { scope, read, write }`, lines 12–29) is the same shape the ADR wants, applied only to `/pub/hypercolor.app/v1/`. Extending it to a group-pubky scope is composition; using it to hide public posts is not.

---

## Phased plan (user-visible value first)

Protocol work (group-as-pubky DAG, content-addressed re-seed, local indexer) proceeds **in parallel**. Nothing below waits for it.

### Phase 0 — cheapest win (read-only graph honesty)

- Opt-in toggle: “Recognise pubky.app follows.”
- On enable, page `NexusClient.following` / `followers` / `friends` (already written) and call `setContactRelationshipFlags` (already written).
- Hydrate names with `nexus.user()` using `PROFILE_HYDRATE_CONCURRENCY`.
- Do not PUT follows. Do not add strangers who merely follow the user (`isFollower` alone stays a request).
- **Visible**: contacts gain Following/Mutual badges that `contacts-sort.ts` already renders; inbound DMs from people you follow auto-accept, as `wotGate.ts` already specifies.

Privacy: §A. Prefer listing own homeserver `/pub/pubky.app/follows/` when a session can read it, so Nexus is not required for *self* hydration.

### Phase 1 — public rooms as a view (still no writes)

- Channels directory: `GET /v0/tags/hot` (optional `reach=wot` after Phase 0).
- Room timeline: `GET /v0/search/posts/by_tag/{label}` and/or `GET /v0/stream/posts?tags=`.
- Open in Hypercolor’s existing thread chrome. Read-only composer: “Posting here publishes to the public graph” disabled until Phase 2.
- **Visible**: the app shows real rooms that already exist on pubky.app.

Privacy: §B–C. Off unless the user opens Channels.

### Phase 2 — compose writes (needs grant)

- Request `/pub/pubky.app/:rw` (or a narrower `/pub/pubky.app/posts/:rw` + `tags/:rw` + `feeds/:rw`) on Enable Messaging, **separately explained** from the Paykit grant.
- Composer: create post + tag (pubky-app’s local-first pattern).
- Optional: persist a `PubkyAppFeed` when the user “saves” a room.
- Do not implement `/pub/hypercolor.app/v1/public-channels/` on web.

Privacy: posting is public; the grant screen must say that.

### Phase 3 — graph-aware requests (hints only)

- On a pending request, fetch `GET /v0/user/{peer}/tags` and relationship. Render provenance. Do not auto-accept on tags.

### Phase 4 — scout, opt-in

- Discovery-only “Ask the graph” using `POST https://nexus-scout.pubky.app/v1/query`.
- Never attach it to inbound DM handling.

### Phase 5 — align with group-as-pubky (when that ADR lands)

- Private groups migrate from pairwise fan-out to group-pubky + caps + DAG.
- Public host keys, if any, *also* tag/post into `/pub/pubky.app/`.
- Local indexer; Nexus/scout remain accelerators.

---

## Open questions

1. **Did mobile Hypercolor (`c7157aaa`) ever write `public-channels/` or follows import?** This web tree is a pin of those types plus a web GroupService that rejects public channels. Resolve: grep the mobile repo’s `GroupService` / contacts services. If mobile already wrote `public-channels/`, Phase 2 needs a read-only importer or a redirect, not a silent drop.
2. **Does production Nexus still have `MUTED` edges?** Watcher in this fork ignores mute PUTs; scout documents them. Resolve: scout count query + compare `synonymdev/pubky-nexus` watcher.
3. **Does pubky-app’s `user.api.muted` hit a live route on `nexus.pubky.app`?** It is not in this fork’s `user/mod.rs`. Resolve: hit production swagger or `GET /v0/user/{id}/muted`.
4. **Exact text of the group-as-pubky ADR** was not read (parallel worktree is off-limits). If it already requires public messages to be specs posts, conflict (1) is void. If it requires the opposite, the conflict is real and should be named in both docs.
5. **Homeserver list of `/pub/pubky.app/follows/` without Nexus**: Paykit session is scoped to `/pub/paykit/` and `/pub/hypercolor.app/v1/`. Unauthenticated `publicGet` of another user’s follows works; listing *own* follows may need a `/pub/pubky.app/:r` grant. Resolve: try `session.list('/pub/pubky.app/follows/')` on a current grant; if denied, Phase 0 uses Nexus for self-following (privacy §A, indexer sees the GET).

---

## Sources actually read

- `pubky-app-specs`: `SPEC.md`; `src/constants.rs`; `src/models/{follow,tag,feed,user,file,bookmark,mute,mod}.rs`; `src/models/post/mod.rs`; `src/uri/resource.rs`
- `pubky-nexus`: `nexus-webapi/src/routes/v0/{endpoints,mod,user/{mod,follows,relationship},stream/{posts,users},search/{posts,users},tag/{mod,global},events}.rs`; `nexus-common/src/types/mod.rs`; `nexus-watcher/src/events/{mod.rs,handlers/mod.rs}`; `tests/tags/wot.rs`; `docs` / README
- `pubky-app`: `core/pipes/follow/follow.normalizer.ts`; `core/controllers/{user/user.ts,tag/tag.ts}`; `core/application/{tag/tag.ts,feed/feed.ts}`; `core/services/local/follow/follow.ts`; `core/services/nexus/{user/{user,user.api}.ts,search/search.api.ts,stream/posts/postStream.api.ts,tag/tag.api.ts,hot/hot.ts}`
- Hypercolor: `src/services/{NexusClient,TrustEngine,StorageService,contacts/addManualContact,group/GroupService,attachments/homeserver,backup/homeserver,link/{link.ts types via types/link.ts,wotGate,ownerRoundtrip}}.ts`; `src/types/{index,group,attachment,link}.ts`; `src/{lib/capabilities,flags/config,components/{contacts-page,channels-page},db/schema}.ts`
- nexus-scout: live `https://nexus-scout.pubky.app/llms.txt` (2026-08-31); `pubky/agent-skills` skill copy; `Synonym/articles/pubky/nexus-scout-agentic-web.md` (product narrative only)
