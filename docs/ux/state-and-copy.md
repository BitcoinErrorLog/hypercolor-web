# State and copy — Hypercolor web

Session machine as implemented, every user-visible label/CTA per state per component, disagreements, and every empty/error/status string found in UI (plus service messages those screens render via `err.message`).

---

## 1. Session state machine

### 1.1 Store kinds

`src/stores/sessionStatusStore.ts` `SessionUiStatus`:

| `kind` | Payload | How it is entered |
|---|---|---|
| `unknown` | none | Initial store value before bootstrap finishes |
| `no-identity` | none | `reset()` (sign-out); `setFromRestore` when restore is not live and `hasIdentity` is false |
| `needs-enable` | none | `setNeedsEnable()` after welcome adopt; `setFromRestore` when restore is not live and `hasIdentity` is true |
| `session-offline` | `pubky` | `setFromRestore` when `restore.status === "session-offline"` |
| `live` | `pubky` | `setFromRestore` when restore is `live` and `getEnableStatus()` is not `"enabled"` (session up, receiver not published) |
| `enabled` | `pubky` | `setEnabled(pubky)` after `provisionReceiver`; or restore live **and** `enable === "enabled"` |

`setFromRestore` **will not downgrade** an in-memory `enabled` to an older snapshot (comment in the store). Genuine loss is `reset` / `setNeedsEnable` / next document load.

Bootstrap: `src/components/session-bootstrap.tsx` (`KeyStore.initKeyStore` → wasm warm → `hydratePersistedAuth` → `restoreSessionOnLoad` → `getEnableStatus` → `setFromRestore`).

Auth identity (`src/stores/authStore.ts`) is separate: `isAuthenticated`, `pubky`, `homeserver`, `profile`. Welcome uses `isAuthenticated`; Enable CTA uses session `kind`.

### 1.2 Helpers (`src/lib/session-ui.ts`)

| Helper | True when |
|---|---|
| `hasIdentity` | `needs-enable` \| `session-offline` \| `live` \| `enabled` (`unknown` and `no-identity` are false) |
| `isMessagingEnabled` | `kind === "enabled"` only |
| `sessionPubky` | pubky on `session-offline` \| `live` \| `enabled` |
| `sessionStatusLabel` | see table below |

| `kind` | `sessionStatusLabel` |
|---|---|
| `unknown` | `Checking session…` |
| `no-identity` | `Not connected` |
| `needs-enable` | `Identity adopted — enable messaging` |
| `session-offline` | `Session offline` |
| `live` | `Session live — publish a receiver` |
| `enabled` | `Encrypted messaging enabled` |

`hasIdentity` is **not** true for `unknown`, so first paint treats the user as signed-out for nav.

---

## 2. Labels and CTAs per state per component

### 2.1 `SiteNav` (`src/components/site-nav.tsx`)

Always (except `/e2e`): Chats, Channels, Discover, Contacts, Requests, Profile, Settings.

| `kind` | Extra link | Label | `href` | Class |
|---|---|---|---|---|
| `unknown`, `no-identity` | yes | **Connect** | `/` | `text-brand` |
| `needs-enable`, `session-offline`, `live` | yes | **Enable** | `/enable` | `text-brand` |
| `enabled` | no extra | — | — | — |

`showEnable = hasIdentity(status) && status.kind !== "enabled"` — so **offline still shows Enable**, not retry.

### 2.2 `EnableMessagingCta` (`src/components/enable-messaging-cta.tsx`)

Shared body: `Encrypted chats need a Ring-approved Paykit session on this device.`

| `kind` | Rendered? | Button label | `href` |
|---|---|---|---|
| `enabled` | no | — | — |
| `unknown`, `no-identity` | yes | **Connect with Pubky Ring** | `/` |
| `session-offline` | yes | **Session offline — try again** | `/enable` (not a restore retry) |
| `needs-enable`, `live` | yes | **Enable encrypted messaging** | `/enable` |

Mounted at: chats list (`chatsEnableMessaging`), channels list (`channelsEnableMessaging`), thread (`threadEnableMessaging`), channel (`channelEnableMessaging`).

### 2.3 `SessionBanner` (`src/components/session-banner.tsx`)

| `kind` | Shown? | Title text | CTA |
|---|---|---|---|
| `unknown` | yes | `Checking session…` | none |
| `session-offline` | yes | `Session offline` | **Try again** (button → `restoreSessionOnLoad` + `getEnableStatus` + `setFromRestore`) |
| other | no | — | — |

### 2.4 `EnablePage` status line (`src/components/enable-page.tsx`)

Does **not** call `sessionStatusLabel`. Local precedence: `enabled` → error → `offline` → `isLoading` → `isExpired` → waiting.

| Condition | Status text | Extra CTAs |
|---|---|---|
| `enabled` | `Encrypted messaging enabled` | **Open chats**, **Sign out** |
| `error` (and not enabled) | `Could not enable encrypted messaging` + raw `{error}` | auth panel if URL still present |
| `offline` | `Session offline` | **Try again** (`getEnableStatus` + `auth.fetchUrl`) |
| `isLoading` | `Checking messaging status…` | auth panel |
| `isExpired` | `Authorization expired` | **Generate new authorization** |
| default | `Waiting for Pubky Ring…` | auth panel |

Capability copy (always): `/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw` inside a `<code>` (raw grant string). Receiver path shown as `Receiver path {provisionedPath}` after success.

### 2.5 Welcome (`src/components/welcome-page.tsx`)

Not keyed only on session kind. Uses `isAuthenticated` + connect hook flags.

| Condition | Copy | CTA |
|---|---|---|
| Authenticated + pubky | `Signed in as {full pubky}. Enable messaging` | link `/enable` |
| `isLoading` | `Preparing paykit-connect…` | — |
| `isExpired` | `This paykit-connect link expired. Generate a new one.` | **Generate new link** |
| else | Auth panel title `Paykit-connect link`, hint `Scan with Pubky Ring on this or another device.` | **Copy URL** / **Open Pubky Ring** (`welcomeActions.tsx`) |
| `pendingPubky` | `Continue as {full z32}?` | **Continue** / **Cancel** |
| `error` | raw `{error}` in `text-red-400` | — |

### 2.6 Profile / Settings session lines

Both call `sessionStatusLabel(status)` (`src/components/profile-page.tsx`, `src/components/settings-page.tsx`). Profile also has `Not connected` when `pubky` is null (overlaps `no-identity` label). Settings: `No identity on this device` when `pubky` is null; `Homeserver: {homeserver \|\| "not set"}`.

### 2.7 `TabLockBanner`

Independent of session kind. Copy: `Hypercolor is open in another tab — take over?` CTA: **Take over**.

---

## 3. Disagreement table

| Topic | `session-ui.ts` | `site-nav.tsx` | `enable-messaging-cta.tsx` | `session-banner.tsx` | `enable-page.tsx` | `profile-page.tsx` |
|---|---|---|---|---|---|---|
| Unsigned (`no-identity`) | `Not connected` | **Connect** | **Connect with Pubky Ring** | hidden | (page still usable if opened) | `Not connected` |
| First paint (`unknown`) | `Checking session…` | **Connect** (because `!hasIdentity`) | **Connect with Pubky Ring** | `Checking session…`, no button | `Checking messaging status…` if hook loading | `Checking session…` |
| Needs enable | `Identity adopted — enable messaging` | **Enable** | **Enable encrypted messaging** | hidden | `Waiting for Pubky Ring…` | session-ui string |
| Live (session, no receiver) | `Session live — publish a receiver` | **Enable** | **Enable encrypted messaging** | hidden | `Waiting for Pubky Ring…` | session-ui string |
| Offline | `Session offline` | **Enable** → `/enable` | **Session offline — try again** → `/enable` | **Try again** restores session in place | **Try again** refetches enable/auth URL | session-ui string |
| Enabled | `Encrypted messaging enabled` | no extra link | hidden | hidden | same string + Open chats | same string |

Concrete mismatches:

1. Nav **Connect** vs CTA **Connect with Pubky Ring**.
2. Nav **Enable** vs CTA **Enable encrypted messaging** vs session-ui **Identity adopted — enable messaging** / **Session live — publish a receiver**.
3. Offline: nav still **Enable**; CTA says try again but links to `/enable`; banner **Try again** actually restores; Enable page **Try again** is a third implementation.
4. `unknown` looks signed-out in nav/CTA and “checking” in the banner at the same time.
5. Enable page never shows “publish a receiver” even in `live`.

---

## 4. Overstated transport, raw capabilities, untruncated z32, raw errors

### 4.1 “delivered” / “read”

`src/components/message-bubble.tsx` `deliveryLabel`:

| `LinkDeliveryState` | Shown |
|---|---|
| `sending` | `sending` |
| `sent` | `sent` |
| `delivered` | `delivered` |
| `read` | `read` |
| `failed` | `failed` |

Appended on **mine** bubbles as ` · {label}`.

`src/types/link.ts`: `CHAT_RECEIPT_KIND = 'chat.receipt.v0'` with comment **“Reserved kind for delivery/read receipts. No receipt logic exists yet.”**

Inbound local persist sets `deliveryState: "delivered"` (`src/services/link/LinkService.ts` around the `LinkMessage` insert for received chat). Outbound success returns `deliveryState: "sent"`. The UI will still print **delivered** for any row stored that way, and **read** if that state is ever set, without a receipt PAM. `LinkService.markRead` updates local `last_read_at` for unread badges; it is not a wire receipt.

Flag: **overstating transport guarantees.**

### 4.2 Raw capability strings

| Location | String |
|---|---|
| `src/components/enable-page.tsx` | `/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw` |
| `src/components/follows-import-panel.tsx` | `/pub/pubky.app/follows/` (homeserver path, not the Ring grant, still raw path) |

`RING_GRANT_CAPABILITIES` in `src/types/link.ts` is the programmatic form; Enable is where users see it.

### 4.3 Untruncated z32 (52-char pubky)

`shortPubky` (`src/lib/format.ts`) is `6…4`. `PubkyAnchors` shows full key with bold head/tail 8 (`src/lib/pubky-anchors.ts`). Full unbroken z32 is shown at:

| File | Where |
|---|---|
| `src/components/thread-view.tsx` | `h2` `data-testid="threadPeer"` `{participantPubky}` |
| `src/components/welcome-page.tsx` | Signed-in `<code>`, adopt `<code>` |
| `src/components/enable-page.tsx` | `identityLabel` |
| `src/components/profile-page.tsx` | `data-testid="profilePubky"` |
| `src/components/settings-page.tsx` | session pubky |
| `src/components/ring-callback-page.tsx` | confirm and done `<code>` |
| `src/components/contact-detail.tsx` | muted mono under the name |
| `src/components/requests-page.tsx` | peer under the name |
| `src/components/contacts-page.tsx` | roster row `truncate` CSS on full `{contact.pubky}` (not `shortPubky`) |
| `src/components/tag-channel-view.tsx` | `post.author` full mono |
| `src/components/message-bubble.tsx` | others’ `message.senderPubky` on group bubbles |
| `src/components/channel-view.tsx` | member `font-mono break-all` when no display name uses `shortPubky`; with name, name only |
| `src/components/auth-url-actions.tsx` | full paykit-connect / auth **URL** (not z32, but untruncated secret-ish grant URL) |

Contacts search results correctly use `PubkyAnchors`. Thread header does not.

### 4.4 Raw `err.message` in the UI

Pattern `setError(err instanceof Error ? err.message : "…")` or `{error}` / `{note}` / `{phase.reason}`:

| File | Fallback if not `Error` | Raw `Error.message` examples that can surface |
|---|---|---|
| `src/services/onboarding/welcomeActions.tsx` | `Handoff failed` / `paykit-connect failed` | RingConnect / decrypt failures |
| `src/services/onboarding/enableActions.tsx` | `Authorization failed` | `provisionReceiver` / auth URL |
| `src/components/ring-callback-page.tsx` | `KeyStore failed to open`, `Handoff failed`, `Failed to notify the waiting computer.` | KeyStore / relay |
| `src/hooks/useThread.ts` | `Could not send this message.` / `Retry failed.` / `Attachment failed.` | LinkService / AttachmentError |
| `src/hooks/useChannel.ts` | `Send failed` / `Attachment failed` / `Reaction failed` / `Remove failed` / `Add failed` / `Leave failed` | `GroupServiceError` messages including `chat.message.v0 event_id must be a UUID`-style wire strings from `src/types/group.ts` |
| `src/hooks/useInbox.ts` | `Could not load conversations` | LinkService sync |
| `src/components/channels-page.tsx` | `Could not create group` | `Channel name must not be empty`, `Private groups are limited to 50 members`, `No established Encrypted Link with that member` |
| `src/components/contacts-page.tsx` | `Could not add contact` / `Search failed` | `addManualContact` / UsernameSearch |
| `src/components/contact-detail.tsx` | `Could not read payment methods` | PaykitList fetch |
| `src/components/requests-page.tsx` | `Accept failed` / `Decline failed` | LinkService |
| `src/components/settings-page.tsx` | `Backup failed` / `Restore failed` | **`BackupService: homeserver transport is not configured. Call configureBackupTransport({ putOwner, getPublic }) or sign in with an owner session before export/restore.`** (`src/services/backup/BackupService.ts`), `BackupService: no active account`, `Recovery code is required`, `No backup found on this account` |
| `src/components/attachment-bubble.tsx` | `Decrypt failed` | `Attachment key is not on this device.` |
| `src/components/follows-import-panel.tsx` | `result.message` from importer | importer failures |
| `src/components/tag-channel-view.tsx` | invalid: `result.message` (`That is not a usable topic label.`); other failures wrapped | Directory load is wrapped in `DISCOVER_INDEX_ERROR` (`src/components/discover-topics.ts`) |

Developer-facing `BackupService: … Call configureBackupTransport` is the worst over-exposure.

---

## 5. User-visible empty / error / status strings (by file)

Strings below appear in UI components (or are the exact `message` those components render from a service). Test-only strings omitted.

### Layout / chrome

| File | String |
|---|---|
| `app/layout.tsx` + `src/lib/app-meta.ts` | `Hypercolor` |
| `src/components/site-nav.tsx` | `Chats`, `Channels`, `Discover`, `Contacts`, `Requests`, `Profile`, `Settings`, `Enable`, `Connect` |
| `src/components/tab-lock-banner.tsx` | `Hypercolor is open in another tab — take over?`, `Take over` |
| `src/components/session-banner.tsx` | (session-ui labels), `Try again` |
| `src/components/enable-messaging-cta.tsx` | `Encrypted chats need a Ring-approved Paykit session on this device.`, `Connect with Pubky Ring`, `Session offline — try again`, `Enable encrypted messaging` |
| `src/lib/session-ui.ts` | six `sessionStatusLabel` strings above |

### Welcome / enable / ring

| File | String |
|---|---|
| `src/components/welcome-page.tsx` | `Your identity is managed by Pubky Ring. Hypercolor never holds your private key. Scan or copy the paykit-connect URL, then enable messaging with a second Ring approval.` ; `Signed in as` ; `Enable messaging` ; `Preparing paykit-connect…` ; `This paykit-connect link expired. Generate a new one.` ; `Generate new link` ; `Continue as` ; `Continue` ; `Cancel` |
| `src/services/onboarding/welcomeActions.tsx` | `Paykit-connect link` ; `Scan with Pubky Ring on this or another device.` ; `Copy URL` ; `Open Pubky Ring` ; `Handoff failed` ; `paykit-connect failed` |
| `src/components/enable-page.tsx` | `Enable encrypted messaging` ; Encrypted DMs / one Paykit session paragraph ; capability `<code>` ; `Status` ; `Encrypted messaging enabled` ; `Could not enable encrypted messaging` ; `Session offline` ; `Checking messaging status…` ; `Authorization expired` ; `Waiting for Pubky Ring…` ; `Receiver path` ; `Ring approved the grant and this device published a receiver marker.` ; `Open chats` ; `Generate new authorization` ; `Try again` ; `Sign out` |
| `src/services/onboarding/enableActions.tsx` | `Authorization URL` ; same scan hint ; `Copy authorization URL` ; `Open Pubky Ring` ; `Authorization failed` |
| `src/components/auth-url-actions.tsx` | `Copied` (after copy) |
| `src/components/auth-qr.tsx` | `aria-label` / `alt` `Authorization QR code` |
| `src/components/ring-callback-page.tsx` | `Ring callback` ; `Reading return URL…` ; `Missing channel id (ch).` ; `Callback is missing pubky, request_id, mode, or homeserver.` ; `Approved — return to your computer.` ; `Continue as` ; `Continue` ; `Identity stored for` ; `Continue to` ; `Enable messaging` ; `KeyStore failed to open` ; `Handoff failed` ; `Failed to notify the waiting computer.` |

### Chats / thread / composer / bubbles

| File | String |
|---|---|
| `src/components/chats-page.tsx` | `Chats` ; `Requests` ; `Paste a pubky to start a chat` ; `Starting…` ; `New chat` ; `No conversations yet.` ; `Start a new chat from the field above.` ; `Try the search field above to start a chat.` (`CHATS_EMPTY_STATE_CANDIDATE_HINT`) |
| `src/services/chats/chatsPageHost.tsx` | `Connect with Pubky Ring first.` ; `Paste a 52-character z-base-32 pubky.` ; plus `addManualContact` messages |
| `src/services/contacts/addManualContact.ts` | `Must be a 52-character z-base-32 pubky (no 0, 2, l, or v).` ; `You cannot add your own pubky.` |
| `src/components/thread-view.tsx` | `Select a conversation.` ; `Invalid conversation` ; `This path is not a DM conversation id.` ; `Direct message` ; `Loading messages…` ; `No messages yet. Send the first one.` |
| `src/components/composer.tsx` | `Attach file` ; `+` ; placeholders `Message` / `Message the group` / `Edit message` ; `Sending…` ; `Send` |
| `src/components/message-bubble.tsx` | `sending` `sent` `delivered` `read` `failed` ; `Retry` ; `Message deleted` ; ` · edited` ; emoji `👍 ❤️ 😂 🔥 👎` ; `Edit` ; `Delete` |
| `src/components/attachment-bubble.tsx` | `Attachment` ; `{contentType} · {size} bytes` ; ` · failed` ; ` · sending` ; `Unavailable from backup until this file is shared again.` ; `Download decrypted file` ; `Decrypting…` ; `Decrypt` ; `Decrypt failed` ; `Attachment key is not on this device.` |
| `src/hooks/useThread.ts` | `Could not send this message.` ; `Retry failed.` ; `Attachment failed.` |
| `src/hooks/useInbox.ts` | `Could not load conversations` |
| `src/lib/inbox.ts` | `Attachment` ; `Payment` ; `Reaction` ; `Group created` ; `Member added` ; `Member removed` ; `Member left` ; `Membership update` ; `No messages yet` |
| `src/lib/format.ts` | `now` ; `{n}m` `{n}h` `{n}d` ; `99+` |

### Channels / groups

| File | String |
|---|---|
| `src/components/channels-page.tsx` | `Channels` ; `New private group` ; `Members must already have an established Encrypted Link with you. Public channels are not available on web.` ; `Group name` ; `No linked contacts yet. Start a DM and complete a handshake first.` ; `Enable encrypted messaging before creating a group.` ; `Creating…` ; `Create group` ; `Could not create group` ; `No channels yet.` ; `No messages yet` (row subtitle) |
| `src/services/group/GroupService.ts` | `Channel name must not be empty` ; `Private groups are limited to 50 members` ; `No established Encrypted Link with that member` ; `Cannot react to a message that is not on this device` ; `Cannot edit a message that is not on this device` ; `Only the original author can edit a message` ; `Cannot delete a message that is not on this device` ; `Only the original author can delete a message` ; `Channel not found` ; `Public channels are out of scope` ; `Use the public-channel publish path` ; `Not an active member of this channel` ; `Only a channel admin can change membership` ; `No local pubky` |
| `src/components/channel-view.tsx` | `Select a channel.` ; `Loading channel…` ; `Channel not found` ; `This group is not on this device. You must be invited over an Encrypted Link.` ; `Private group` ; `Members ({n})` ; `{role}` ; ` · removed` ; `Remove` ; `New members must already have an established Encrypted Link with you. Fan-out never starts a handshake.` ; `Paste a linked pubky` ; `Add member` ; `Leave group` ; `No messages yet.` |
| `src/hooks/useChannel.ts` | `Send failed` ; `Attachment failed` ; `Reaction failed` ; `Remove failed` ; `Member must be a 52-character z-base-32 pubky with an established link.` ; `Add failed` ; `Leave failed` |

### Discover

| File | String |
|---|---|
| `src/components/discover-page.tsx` | `Discover` ; privacy paragraph (`This is the global public index…`) ; `Loading topics…` ; `Retry public topics` ; `Load public topics` ; `The public index has no hot tags right now.` ; `{n} posts · {n} taggers` |
| `src/components/discover-topics.ts` | `The public index is unreachable or returned unusable data. Private chats are not listed here.` |
| `src/components/tag-channel-view.tsx` | `Open a public topic to read posts the index already has.` ; `Public topic` ; opening-this-view privacy paragraph ; `Posting is disabled` ; `Posting here publishes to the public graph. Publishing is not available in this release.` ; `Write a public post` ; `Loading public posts…` ; `The public index is unreachable or returned unusable data. This is not your message history.` ; `No posts in this index for this tag.` ; `{n} indexed row(s) had no usable post body.` |
| `src/services/nexus/tagChannel.ts` | `That is not a usable topic label.` |

### Contacts / requests / profile / settings

| File | String |
|---|---|
| `src/components/contacts-page.tsx` | `Contacts` ; `Requests` ; `Paste a pubky or search a username` ; identity/privacy paragraph ; `Adding…` ; `Add contact` ; `Searching…` ; `Search username` ; `Add by pubky` ; `No usernames matched. A username is not an identity — paste the pubky.` ; `This name mixes character sets that can look alike. The check is incomplete — compare the full pubky.` ; `Name is a label. This pubky is the identity.` ; `Add this pubky` ; `Suggestions from pubky.app follows` ; `Not your contact list. Add one to keep them. Hypercolor does not write a follow.` ; `Add as contact` ; `No contacts yet.` ; `Select a contact.` ; `Connect with Pubky Ring first.` ; `Could not add contact` ; `Search failed` |
| `src/services/contacts/usernameSearch.ts` | `Enter a username or paste a pubky.` ; `Type at least 2 characters, or paste a pubky.` ; `That username is too long to search.` ; `That is not a username.` ; `The public index is unreachable. Paste a pubky instead.` |
| `src/lib/contacts-sort.ts` | badges `Mutual` ; `Following` ; `Added` |
| `src/components/follows-import-panel.tsx` | `pubky.app follows` ; long privacy copy ; `Follows import is on. Suggestions stay separate from contacts you added.` ; `Reading…` ; `Refresh follows` ; `Stop using follows` ; understand-checkbox copy ; `Use my pubky.app follows to recognise people` ; `Read {n} follows from your homeserver.` ; `Confirmed {n} follows against your homeserver after the public index listed candidates.` ; `Import is off. Follow recognition was cleared. …` ; `No confirmed follows yet.` ; `Imported {n} confirmed follows as suggestions.` |
| `src/components/contact-detail.tsx` | `Loading contact…` ; `Contact` ; `Relationship` ; `Not in your contacts yet.` ; `Encrypted Link` ; `No Encrypted Link on this device yet. Sending a DM starts the handshake.` ; `{status} · {role}` ; `Trust` ; `Score {n} — used only for sorting, never to block delivery.` ; `Public payment methods` ; `Read-only from their Paykit receiver. This app does not send payments.` ; `Could not read payment methods` ; `No public methods published.` ; `Open chat` |
| `src/services/TrustEngine.ts` | `Interaction history` ; `Recent interaction` ; `Homeserver resolved via PKDNS` ; `Mutual follow` ; `You follow them` ; `No relationship` |
| `src/components/requests-page.tsx` | `Message requests` ; intro paragraph (accept/decline/group name only) ; `No pending requests.` ; `New inbound conversations wait here until you accept.` ; `Group invitation` ; `Accept` ; `Decline` ; `Accept failed` ; `Decline failed` |
| `src/components/profile-page.tsx` | `Profile` ; `Settings` ; `Unnamed` ; `Not connected` ; `Keys managed by Pubky Ring` ; `Sign out` |
| `src/components/settings-page.tsx` | `Settings` ; `Session` ; `No identity on this device` ; `Homeserver:` ; `not set` ; `Encrypted backup` ; backup explanation paragraph ; `Working…` ; `Backup now` ; `Write this recovery code down` ; `Copied` ; `Copy` ; `I have saved this recovery code somewhere I control.` ; `I saved it — hide this code` ; `Paste recovery code to restore` ; `Restore from backup` ; `Restore complete. History is local. Enable messaging again so links re-handshake. Attachments without keys stay unavailable until re-shared.` ; `Backup failed` ; `Restore failed` ; `Sign out` |
| `src/services/backup/BackupService.ts` | `Recovery code is required` ; `No backup found on this account` ; `BackupService: no active account` ; `BackupService: homeserver transport is not configured. Call configureBackupTransport({ putOwner, getPublic }) or sign in with an owner session before export/restore.` |

### Harness pages (visible if flag on)

| File | String |
|---|---|
| `src/components/dm-harness-page.tsx` | `DM staging harness` + Playwright/window copy |
| `src/components/groups-harness-page.tsx` | `Groups staging harness` + copy |
| `src/components/payments-harness-page.tsx` | `Payments staging harness` + copy |
| `src/components/backup-harness-page.tsx` | `Backup staging harness` + copy |
| `src/components/attachment-roundtrip-page.tsx` | `Attachment staging harness` + copy |
| `src/components/owner-roundtrip-page.tsx` | `Owner round-trip harness` + copy |
