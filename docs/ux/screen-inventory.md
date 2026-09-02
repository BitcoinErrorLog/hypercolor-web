# Screen inventory — Hypercolor web

Inventory of every App Router route, page host, panel, inline surface, and banner as implemented on `main` @ `eeb6710`. Every row cites a file that was read. No dialog / sheet / drawer primitive exists (`src/components/ui/` contains only `button.tsx` and `input.tsx`).

**Chrome (every non-`/e2e` route):** `app/layout.tsx` mounts `SessionBootstrap`, `PwaRegister`, `TabLockBanner`, `SessionBanner`, a header (`APP_NAME` + `SiteNav`), then `<main>{children}</main>`. `/e2e/*` still gets the header brand and banners; `SiteNav` returns `null` when `pathname.startsWith("/e2e")` (`src/components/site-nav.tsx`).

**Breakpoints used in product UI:** Tailwind `md` (768px). Master/detail lists use `md:grid-cols-[minmax(16rem,20rem)_1fr]`. `<md` (including 390px) shows **either** the list **or** the detail, never both. There is no in-pane Back control on any detail header.

**Deep-link mechanism:** static export only emits the empty catch-all (`generateStaticParams` returns `{ conversationId: [] }` / `{ id: [] }` / `{ pubky: [] }` / `{ tag: [] }`). Hard refresh of `/:seg/:id` depends on `vercel.json` rewrites into the list HTML; the client then reads the extra segment via `usePathSegment` → `readPathId` (`src/hooks/usePathSegment.ts`, `src/lib/path-id.ts`). `usePathSegment` subscribes only to `popstate` (not `pushState`). Local static preview that applies those rewrites: `npm run preview:static` (`scripts/static-preview.mjs`). Plain `npx serve out` 404s nested paths.

**SW shell:** `public/sw.js` `SHELL` (network-first document cache). Routes not in `SHELL` are not intercepted; offline navigation throws `hypercolor: offline and no cached document for this route`.

---

## 1. Routes

| URL | App file | Host / page component | Enter | Exit | `<md` (390px) | `md+` (1280px) | `vercel.json` rewrite | SW `SHELL` |
|---|---|---|---|---|---|---|---|---|
| `/` | `app/page.tsx` | `WelcomePageHost` → `WelcomePage` | Direct, PWA `start_url`, SiteNav **Connect**, EnableMessagingCta when `no-identity`/`unknown` | After adopt: `router.push("/enable")`. Nav to any product link. No dedicated dismiss of the QR. | Single column: title, QR, copy/open, optional adopt card | Same, `max-w-5xl` | none (real static path) | yes `/` |
| `/enable` | `app/enable/page.tsx` | `EnablePageHost` → `EnablePage` | SiteNav **Enable**, Welcome “Enable messaging”, CTA when identity exists, Ring-callback “Enable messaging” link, post-adopt redirect | “Open chats” → `/chats`. Sign out stays on page and refetches auth URL. Nav away (including before grant). | Single column: status card + QR | Same | none | yes `/enable` |
| `/chats` | `app/chats/[[...conversationId]]/page.tsx` | `ChatsPageHost` → `ChatsPage` | SiteNav **Chats**, Enable “Open chats”, ContactDetail “Open chat” | Start-chat success → `/chats/{dmId}`. Requests link → `/requests`. | List only (`aside` visible; detail `hidden`) | List + empty detail “Select a conversation.” | n/a (generated) | yes `/chats` |
| `/chats/:conversationId` | same catch-all | same + `ThreadViewHost` → `ThreadView` | Chat row `Link`, start-chat, request accept, contact “Open chat” | No in-pane Back. SiteNav **Chats** → `/chats`. Peer short-id → `/contacts/{pubky}`. Browser back. | Detail only (`aside` `hidden md:block`) | List + thread | `{ "source": "/chats/:conversationId", "destination": "/chats" }` | **no** (`/chats/:id` is not in `SHELL`; only exact `/chats`) |
| `/channels` | `app/channels/[[...id]]/page.tsx` | `ChannelsPage` | SiteNav **Channels** | Create success → `/channels/{channelId}` | List + create form | List + “Select a channel.” | n/a | yes `/channels` |
| `/channels/:id` | same | `ChannelsPage` + `ChannelView` | Channel row, create redirect | No in-pane Back. SiteNav **Channels**. Members toggle is in-pane, not navigation. | Detail only | List + channel | `{ "source": "/channels/:id", "destination": "/channels" }` | **no** (exact `/channels` only) |
| `/discover` | `app/discover/[[...tag]]/page.tsx` | `DiscoverPage` | SiteNav **Discover** | Load topics is in-place. Tag row → `/discover/{tag}` | Privacy copy + opt-in load button | List + “Open a public topic…” | n/a | **no — omitted from `SHELL`** |
| `/discover/:tag` | same | `DiscoverPage` + `TagChannelView` | Tag row `Link` | No in-pane Back. SiteNav **Discover**. Composer is disabled (not an exit). | Timeline only | List + timeline | **missing** (not in `vercel.json`) | **no** |
| `/contacts` | `app/contacts/[[...pubky]]/page.tsx` | `ContactsPage` | SiteNav **Contacts** | Add success → `/contacts/{pubky}`. Requests link → `/requests` | List + search + follows panel | List + “Select a contact.” | n/a | yes `/contacts` |
| `/contacts/:pubky` | same | `ContactsPage` + `ContactDetail` | Contact row, add/search hit | No in-pane Back. “Open chat” → `/chats/{dmId}`. SiteNav **Contacts**. | Detail only | List + detail | `{ "source": "/contacts/:pubky", "destination": "/contacts" }` | **no** (exact `/contacts` only) |
| `/requests` | `app/requests/page.tsx` | `RequestsPage` | SiteNav **Requests**, Chats/Contacts “Requests” links | Accept → `/chats/{threadId}`. Decline stays and reloads. | Single column list | Same | none | yes `/requests` |
| `/profile` | `app/profile/page.tsx` | `ProfilePage` | SiteNav **Profile** | Settings link → `/settings`. Sign out stays on profile (session resets). | Single column | Same | none | yes `/profile` |
| `/settings` | `app/settings/page.tsx` | `SettingsPage` | SiteNav **Settings**, Profile “Settings” | Sign out stays. Recovery panel hide is in-place. **Nav is not gated** while the recovery code is shown. | Single column | Same | none | yes `/settings` |
| `/ring-callback` | `app/ring-callback/page.tsx` | `RingCallbackPage` | Pubky Ring return URL (`?ch=&pubky=&request_id=&mode=&homeserver=`) | Relay-forwarded: copy only (“return to your computer”). Confirm → done + `<a href="/enable">`. Invalid/error: no retry control. SiteNav still present. | Single column | Same | none (query string on a real path) | **no** |
| `/e2e/dm-harness` | `app/e2e/dm-harness/page.tsx` | `DmHarnessPage` | Playwright / typed URL when `NEXT_PUBLIC_E2E_HARNESS=1` | Nav hidden. Leaving is a full navigation. Else `requireE2eHarness` → `notFound()`. | Harness copy only | Same | none | **excluded** (`shouldCache` false for `/e2e`) |
| `/e2e/groups-harness` | `app/e2e/groups-harness/page.tsx` | `GroupsHarnessPage` | same | same | same | same | none | excluded |
| `/e2e/payments-harness` | `app/e2e/payments-harness/page.tsx` | `PaymentsHarnessPage` | same | same | same | same | none | excluded |
| `/e2e/backup-harness` | `app/e2e/backup-harness/page.tsx` | `BackupHarnessPage` | same | same | same | same | none | excluded |
| `/e2e/attachment-roundtrip` | `app/e2e/attachment-roundtrip/page.tsx` | `AttachmentRoundtripPage` | same | same | same | same | none | excluded |
| `/e2e/owner-roundtrip` | `app/e2e/owner-roundtrip/page.tsx` | `OwnerRoundtripPage` | same | same | same | same | none | excluded |

There is no `app/not-found.tsx`, `app/error.tsx`, or `app/loading.tsx`. Unknown paths fall through to the static host 404, not an in-app screen.

`productRouteFromPathname` (`src/services/vibeware/route.ts`) does **not** include `discover` or any `/e2e` route, so `app.route.viewed` is not emitted for Discover.

---

## 2. Page hosts and primary surfaces

| Surface | File | Role |
|---|---|---|
| Root layout | `app/layout.tsx` | Fonts, PWA metadata, chrome |
| Site nav | `src/components/site-nav.tsx` | Seven always-on text links + conditional **Enable** or **Connect** |
| Welcome | `src/services/onboarding/welcomeActions.tsx`, `src/components/welcome-page.tsx` | Paykit-connect QR + adopt confirm |
| Enable | `src/services/onboarding/enableActions.tsx`, `src/components/enable-page.tsx` | Ring grant QR + receiver provision |
| Auth QR chrome | `src/components/auth-url-panel.tsx`, `src/components/auth-qr.tsx` | Writable QR display |
| Auth URL actions | `src/components/auth-url-actions.tsx` | Copy + `href` open (forbidden for vibeware candidates) |
| Chats list | `src/services/chats/chatsPageHost.tsx`, `src/components/chats-page.tsx` | Inbox rows, start-chat form, empty hint |
| Thread | `src/services/thread/threadActions.tsx`, `src/components/thread-view.tsx` | DM timeline + composer |
| Composer | `src/components/composer.tsx` | Text + optional `+` attach |
| DM bubble | `src/components/message-bubble.tsx` `DmMessageBubble` | Body, clock, delivery label, Retry |
| Group bubble | `src/components/message-bubble.tsx` `GroupMessageBubble` | Body, sender z32, emoji, Edit/Delete |
| Attachment | `src/components/attachment-bubble.tsx` | Decrypt / image / download |
| Channels list | `src/components/channels-page.tsx` | Create-group form + channel rows |
| Channel thread | `src/components/channel-view.tsx` | Group timeline + members panel |
| Discover | `src/components/discover-page.tsx`, `src/components/discover-topics.ts` | Opt-in public hot tags |
| Tag timeline | `src/components/tag-channel-view.tsx` | Public posts; posting disabled |
| Contacts | `src/components/contacts-page.tsx` | Search, suggestions, roster |
| Follows import | `src/components/follows-import-panel.tsx` | Opt-in pubky.app follows read |
| Pubky anchors | `src/components/pubky-anchors.tsx` | Head/tail emphasis of full z32 |
| Contact detail | `src/components/contact-detail.tsx` | Relationship, link, trust, read-only Paykit methods |
| Requests | `src/components/requests-page.tsx` | Accept / Decline |
| Profile | `src/components/profile-page.tsx` | Identity + sign out |
| Settings | `src/components/settings-page.tsx` | Session, backup/restore, sign out |
| Ring callback | `src/components/ring-callback-page.tsx` | Relay vs same-device adopt |
| Enable CTA card | `src/components/enable-messaging-cta.tsx` | Inline gate on chats/channels/thread/channel |
| Session banner | `src/components/session-banner.tsx` | `unknown` / `session-offline` |
| Tab lock banner | `src/components/tab-lock-banner.tsx` | Non-writer tab |
| Harnesses | `src/components/{dm,groups,payments,backup}-harness-page.tsx`, `attachment-roundtrip-page.tsx`, `owner-roundtrip-page.tsx` | `window.run*` only |

---

## 3. Panels, inline “modals”, and banners

There is no `<dialog>`, `role="dialog"`, or shadcn Dialog. Every overlay is an in-flow card or a top banner.

| Surface | File | Kind | Open | Close / leave |
|---|---|---|---|---|
| Tab-lock banner | `src/components/tab-lock-banner.tsx` | Global banner `role="status"` | `initTabLock` / `subscribeTabLock` when `mode !== "writer"` | **Take over** → `requestTakeover()`. No dismiss-without-takeover. |
| Session banner | `src/components/session-banner.tsx` | Global banner `role="status"` | `status.kind` is `unknown` or `session-offline` | Offline: **Try again** re-runs `restoreSessionOnLoad`. `unknown` has no button. Hidden once status is any other kind. |
| Enable-messaging CTA | `src/components/enable-messaging-cta.tsx` | In-flow card | Mounted on chats list, channels list, thread, channel when `kind !== "enabled"` | Navigates to `/` or `/enable`. Not dismissible. |
| Paykit-connect / auth URL panel | `src/components/auth-url-panel.tsx` | In-flow | Welcome/Enable while a URL exists and not expired | Replaced by “Generate new link/authorization” on expiry. |
| Welcome adopt card | `src/components/welcome-page.tsx` `data-testid="welcomeAdopt"` | In-flow confirm | `decryptPendingHandoff` succeeded | **Continue** → `/enable`. **Cancel** clears pending (emits `app.onboarding.abandoned`). |
| New-chat form | `src/components/chats-page.tsx` | In-flow form | Always on chats list | Submit starts a DM; errors stay under the form. |
| New private group form | `src/components/channels-page.tsx` | In-flow card | Always on channels list | Submit navigates into the new channel. |
| Channel members panel | `src/components/channel-view.tsx` | In-flow `<section>` | **Members (n)** toggle | Toggle again. Contains Add member, Remove, Leave group. |
| Channel add-member form | same, inside members | In-flow | Admin only | Submit; no separate modal. |
| Follows-import panel | `src/components/follows-import-panel.tsx` | In-flow card | Contacts list when `ownerPubky` is set | Enable/disable in place. Hidden when signed out. |
| Username search results | `src/components/contacts-page.tsx` `data-testid="contactSearchResults"` | In-flow list | Username search returned hits | Cleared when draft changes or a contact is added. |
| Follow suggestions | `src/components/contacts-page.tsx` `data-testid="followSuggestions"` | In-flow list | Imported follows that are not roster | **Add as contact** moves them to the roster. |
| Recovery code panel | `src/components/settings-page.tsx` `data-testid="recoveryCodePanel"` | In-flow card | **Backup now** success | Hide enabled only after checkbox (`canDismissRecoveryCode` in `src/lib/backup-gate.ts`). **SiteNav / any route change is not blocked.** `useLeaveOnce` only emits `app.backup.export_outcome` `cancelled`. |
| Restore field | `src/components/settings-page.tsx` | In-flow | Always | Success/error `note` under the buttons. |
| Tag-channel disabled composer | `src/components/tag-channel-view.tsx` `data-testid="tagChannelComposerDisabled"` | In-flow card | Whenever a tag is open | Disabled **Write a public post** (`h-8`); not a modal. |
| Attachment decrypt card | `src/components/attachment-bubble.tsx` | In-message card | Attachment PAM in timeline | Decrypt in place; no close. |
| Group membership system line | `src/components/message-bubble.tsx` | Inline centered text | Membership kind | Not interactive. |

---

## 4. Master/detail behavior (`<md` vs `md+`)

Shared pattern (all four lists):

```html
<div class="grid min-h-[70vh] gap-6 md:grid-cols-[minmax(16rem,20rem)_1fr]">
  <aside class="{id ? 'hidden md:block' : undefined}">…list…</aside>
  <section class="{!id ? 'hidden md:block' : undefined}">…detail…</section>
</div>
```

| Screen | List file | Detail file | Detail header Back? | How a 390px user returns to the list |
|---|---|---|---|---|
| Chats | `src/components/chats-page.tsx` | `src/components/thread-view.tsx` | **No.** Header is “Direct message” + full peer z32 + `shortPubky` link to contacts. | SiteNav **Chats** (`href="/chats"`) or browser Back. |
| Channels | `src/components/channels-page.tsx` | `src/components/channel-view.tsx` | **No.** Header is “Private group” + name + Members toggle. | SiteNav **Channels** or browser Back. |
| Discover | `src/components/discover-page.tsx` | `src/components/tag-channel-view.tsx` | **No.** Header is “Public topic” + `#tag`. | SiteNav **Discover** or browser Back. Hard refresh of `/discover/:tag` is a host 404 (no rewrite). |
| Contacts | `src/components/contacts-page.tsx` | `src/components/contact-detail.tsx` | **No.** Header is “Contact” + name + full z32. | SiteNav **Contacts** or browser Back. |

Single-column routes (no master/detail): `/`, `/enable`, `/requests`, `/profile`, `/settings`, `/ring-callback`, all `/e2e/*`.

`SiteNav` is `flex flex-wrap gap-x-4 gap-y-2 text-sm` (`src/components/site-nav.tsx`) inside `px-6 py-4` (`app/layout.tsx`). At 390px the seven product links plus **Enable** or **Connect** wrap to two or more lines. There is no hamburger, no current-route-only chrome, no icons.

---

## 5. Trapped / dead-end audit (390px)

A state is trapped if the 390px viewport has **no** forward action and **no** back affordance that is visible in the pane (browser chrome is not counted as an in-app control). SiteNav remains on all product routes except `/e2e/*`.

| State | Path / surface | Forward? | Back / escape? | Verdict |
|---|---|---|---|---|
| Thread open | `/chats/:id` | Composer if enabled; peer link to contacts | **No in-pane Back.** SiteNav Chats works. | **Missing back**, not fully trapped |
| Invalid DM id | `ThreadView` “This path is not a DM conversation id.” | None | Same: only SiteNav / browser | **Dead-end pane** |
| Channel open | `/channels/:id` | Composer / Members | No in-pane Back | **Missing back** |
| Channel not found | `ChannelView` “This group is not on this device…” | None | Only SiteNav / browser | **Dead-end pane** |
| Tag open | `/discover/:tag` | None (posting disabled) | No in-pane Back | **Missing back** |
| Tag hard-refresh / share | `/discover/:tag` | Host 404 (no `vercel.json` rewrite) | Browser Back only; in-app chrome never loads | **Trapped / broken deep link** |
| Discover offline (never cached) | `/discover` | SW does not intercept; fetch throws | Browser error page | **Offline dead-end** |
| Contact open | `/contacts/:pubky` | Open chat | No in-pane Back | **Missing back** |
| Contact loading then empty | `ContactDetail` without `ownerPubky` | Open chat still rendered | Same | Weak empty, not trapped |
| Requests empty | `/requests` | None besides nav | SiteNav | OK |
| Welcome waiting for Ring | `/` | Copy / Open Ring | Nav away (abandon emit). No skip. | Escapable via nav |
| Welcome expired | `/` | **Generate new link** | Nav | OK |
| Enable waiting | `/enable` | Copy / Open Ring | Nav away (abandon emit). No skip. | Escapable via nav |
| Enable expired | `/enable` | **Generate new authorization** | Nav | OK |
| Enable offline | `/enable` | **Try again** | Nav | OK |
| Session-offline banner | layout | Banner **Try again**; nav **Enable** (not “retry”) | Banner is not blocking | Escapable; copy conflict |
| Tab-lock non-writer | layout | **Take over** only | Cannot use the product without taking over; nav still clickable but writers live in the other tab | **Blocked** until takeover |
| Recovery code shown | `/settings` | Copy, checkbox, hide | **Can navigate away** with the code still in React state until unmount; no `beforeunload` | **Unsafe leave** (see feature/copy docs) |
| Ring callback invalid | `/ring-callback` | None | SiteNav still shown; heading only | Escapable via nav; no retry |
| Ring callback relay-forwarded | `/ring-callback` | None (instruction to return to computer) | SiteNav | Intentional terminal on phone |
| Composer disabled | thread/channel when not enabled | Enable CTA is the forward path | — | OK |
| Tag “Write a public post” | disabled `h-8` button | None | — | Intentionally inert |
| `/e2e/*` with harness off | `requireE2eHarness` | `notFound()` | Host 404 | Expected |
| `/e2e/*` with harness on | harness pages | No product nav (`SiteNav` null) | Browser Back / URL | **No in-app nav** (dev-only) |

`inbox.loading` exists on `useInbox` / `inboxStore` but `ChatsPage` has no loading prop, so the chats list has no loading surface and can flash empty (`src/components/chats-page.tsx`, `src/services/chats/chatsPageHost.tsx`). Channels/contacts/requests likewise render the empty copy before `loaded` is true.

---

## 6. Rewrite and SW matrix (authoritative snippets)

`vercel.json` rewrites (complete file):

- `/chats/:conversationId` → `/chats`
- `/channels/:id` → `/channels`
- `/contacts/:pubky` → `/contacts`
- **No** `/discover/:tag`
- **No** `/enable`, `/requests`, `/profile`, `/settings`, `/ring-callback` (those are real exported paths)

`public/sw.js` `SHELL`:

`/`, `/chats`, `/channels`, `/contacts`, `/requests`, `/settings`, `/profile`, `/enable`, `/manifest.webmanifest`, `/icon.svg`.

Omitted vs product nav: **`/discover`**, **`/discover/:tag`**, **`/ring-callback`**, all detail URLs, all `/e2e/*` (explicitly skipped).
