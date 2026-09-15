# VRT state matrix — Hypercolor web

Visual states to capture per surface at **390px** and **1280px**, the deterministic fixture each needs, and regions to mask. Then: what is already installed, how to add a catalog **without new runtime dependencies**, and what vibeware path policy allows. This document does not implement anything.

---

## 1. Existing tooling (read from tree)

### Vitest (`vitest.config.mts`)

- `environment: "node"` (not jsdom, not happy-dom).
- `include`: `src/**/*.test.ts`, `scripts/**/*.test.mjs`.
- Alias `@` → `src`.
- No `@testing-library/react`, no `jsdom` package in `package.json`.
- Component tests that exist (`chats-page.empty-state.test.ts`, `discover-page.test.ts`, `follows-import-panel.test.ts`, `discover-topics.test.ts`) are **logic/string tests**, not renders.

Vitest **cannot** snapshot React trees with the current install.

### Playwright (`playwright.config.ts`)

- `testDir: "./e2e"`.
- `fullyParallel: true`.
- `use.baseURL`: `PLAYWRIGHT_BASE_URL` or `http://localhost:3000`.
- `trace: "on-first-retry"`.
- **No `projects` array** — one default Chromium project, default viewport (~1280×720), no 390px project.
- **No `expect.toHaveScreenshot`**, no `snapshotPathTemplate`, no screenshot `maxDiffPixelRatio`.
- **No `reporter`** — Playwright default list; HTML reporter is available inside `@playwright/test` but not wired.
- `webServer` (when `PLAYWRIGHT_BASE_URL` unset): `npm run dev -- --port 3000` with `NEXT_PUBLIC_E2E_HARNESS: "1"`, `reuseExistingServer` unless `CI`, timeout 120s.

`package.json` scripts: `test:e2e` = `playwright test`; staging proofs set `NEXT_PUBLIC_E2E_HARNESS=1` plus `RUN_STAGING_*`.

### `requireE2eHarness` (`src/lib/require-e2e-harness.ts`, `src/lib/e2e-harness.ts`)

- `isE2eHarnessEnabled()` ⇔ `process.env.NEXT_PUBLIC_E2E_HARNESS === "1"`.
- Every `app/e2e/*/page.tsx` calls `requireE2eHarness()` then the harness component.
- Off → `notFound()` (no in-app 404 page).
- Playwright `webServer` already injects the flag for local `npm run test:e2e`.
- Production static export should leave the env unset so harness routes 404.

Pattern already used: a route behind the flag that attaches `window.run*` and renders a short article. That is the seam for a **fixture catalog** of production components.

### E2E spec list (`e2e/`)

| Spec | Gating | What it does |
|---|---|---|
| `e2e/home.spec.ts` | none | `/` heading Hypercolor |
| `e2e/ui-smoke.spec.ts` | none | empty-state headings/copy on `/`, `/chats`, `/channels`, `/contacts`, `/requests`, `/settings`, `/profile` |
| `e2e/ring-callback.spec.ts` | none | missing `ch`; welcome QR + copy/open |
| `e2e/vibeware-collector.spec.ts` | harness sink (dev server sets flag) | forged events dropped |
| `e2e/dm-staging.spec.ts` | `RUN_STAGING_DM=1` | live DM via `/e2e/dm-harness` |
| `e2e/groups-staging.spec.ts` | `RUN_STAGING_GROUPS=1` | groups harness |
| `e2e/payments-staging.spec.ts` | `RUN_STAGING_PAYMENTS=1` | payments harness |
| `e2e/backup-staging.spec.ts` | `RUN_STAGING_BACKUP=1` | backup harness |
| `e2e/attachment-staging.spec.ts` | `RUN_STAGING_ATTACH=1` | attachment harness |
| `e2e/owner-roundtrip.spec.ts` | `RUN_STAGING_OWNER_ROUNDTRIP=1` | owner harness |
| `e2e/dm-send-prod.spec.ts` | `RUN_PROD_DM_SEND=1` | prod origin + invite script |
| `e2e/sw-upgrade.spec.ts` | `PLAYWRIGHT_BASE_URL` + `SW_UPGRADE_SW_PATH` | local SW v2→v3 |
| `e2e/sw-upgrade-prod.spec.ts` | skip unless env | prod SW; uses `page.screenshot` to `/tmp/hc-gate/leg1-chats.png` (ad-hoc, not `toHaveScreenshot`) |
| `e2e/sw-upgrade-live.spec.ts` | `RUN_STAGING_DM=1` + bypass | live upgrade |

`e2e/fixtures/sw-v2.js` is a SW fixture, not a UI fixture.

### CI (`.github/workflows/ci.yml`)

Checkout → (PR) vibeware gates from **base** tree → `npm ci` → typecheck → lint → (push) `check:vibeware` → **`npm test` (Vitest only)** → wasm smoke → wire drift.

**Playwright is not a CI step.** No screenshot artifact, no HTML report upload.

---

## 2. Fixture rules (all states below)

Deterministic means:

- `NEXT_PUBLIC_E2E_HARNESS=1` so catalog routes exist.
- **No network:** stub `fetch`, do not call Nexus, homeserver, or Ring. Discover/contact search/payment list must be fixture JSON.
- **No real identities:** pubkeys are fixed 52-char z32 fixtures (same string every run), not KeyStore/Ring.
- Freeze time: `formatRelativeTime` / `formatClock` / `toLocaleDateString` (`src/lib/format.ts`) use `Date.now()` and locales — either inject `now` (relative helper already accepts `now`) at the catalog boundary or **mask** clocks.
- Session: seed `useSessionStatusStore` / `useAuthStore` in the catalog host; do not run `SessionBootstrap` against live wasm for VRT (or run bootstrap with a mocked `restoreSessionOnLoad`).
- Tab lock: force `writer` unless the tab-lock state is under test.
- Fonts: Geist from Google in `app/layout.tsx` is **nondeterministic** unless the catalog page uses a local font or CI caches the font; mask or subset.

---

## 3. Shared chrome states (capture once, reuse)

Capture at 390 and 1280, full header + banners + a stable main stub.

| State | How to fixture | Mask |
|---|---|---|
| Nav, no identity | `status.kind = "no-identity"` | none besides fonts |
| Nav, needs-enable (8th **Enable** link) | `needs-enable` | — |
| Nav, enabled (7 links) | `enabled` + fixture pubky | — |
| Session banner unknown | `unknown` | — |
| Session banner offline + Try again | `session-offline` | — |
| Tab-lock banner | lock `mode !== "writer"` | — |
| Both banners stacked | offline + non-writer | — |
| `/e2e` chrome (nav hidden) | pathname `/e2e/ux-catalog` | — |

---

## 4. Per-route visual states

Legend: **390** = list-or-detail only for master/detail; **1280** = both columns. Every state in the table should be shot at **both** widths unless marked 390-only / 1280-only.

### `/` Welcome — `src/components/welcome-page.tsx`

| State | Fixture | Mask |
|---|---|---|
| Loading | `isLoading=true`, no URL | — |
| QR populated | fixture auth URL string (stable) + `AuthQr` | **QR `<img>`** (pixel-level PNG from `generateAuthQrDataUri` is deterministic for a frozen URL; still mask if font/subpixel around it). Auth URL paragraph. |
| Expired | `isExpired=true` | — |
| Authenticated strip | `isAuthenticated`, fixture pubky | **full z32** |
| Adopt confirm | `pendingPubky` fixture | **z32** |
| Error | `error="Handoff failed"` canned | — |

### `/enable` — `src/components/enable-page.tsx`

| State | Fixture | Mask |
|---|---|---|
| Waiting + QR | `enabled=false`, URL present | QR, auth URL, capability `<code>` optional |
| Checking | `isLoading` | — |
| Expired | `isExpired` | — |
| Offline | `offline` | — |
| Error | `error` canned | — |
| Enabled + receiver path | `enabled`, `provisionedPath="hypercolor/wallet"` | z32 identityLabel |
| Sign out visible | enabled | — |

### `/chats` list — `src/components/chats-page.tsx`

| State | Fixture | Mask |
|---|---|---|
| Loading (gap: not implemented) | would need a host that passes loading; **today there is no UI** — document as missing, do not invent a spinner | — |
| Empty + control hint | `rows=[]`, default hint | — |
| Empty + candidate hint | `emptyStateHint=CHATS_EMPTY_STATE_CANDIDATE_HINT` | — |
| Empty + Enable CTA | `status !== enabled` | — |
| Start-chat error | `startError` canned | — |
| Starting disabled button | `starting=true` | — |
| Populated DMs + groups | 3 fixture rows, unread 0 / 3 / 100 (exercises `99+`) | **relative time** (`formatRelativeTime`); preview text OK if fixture |
| Inbox error | `inboxError` canned | — |
| Pending requests badge | `pendingRequests=2` | — |
| 1280 empty detail | `conversationId=null` | “Select a conversation.” |
| 390 list | same as populated | times |

### `/chats/:id` thread — `src/components/thread-view.tsx`

| State | Fixture | Mask |
|---|---|---|
| Invalid id | `participantPubky=null` | — |
| Loading | `loading=true` | — |
| Empty thread | `messages=[]`, enabled | z32 header |
| Populated | 2 mine + 2 theirs; one `deliveryState: "sent"`, one `"failed"` with Retry; one attachment slot | **z32 header**, **clocks** (`formatClock`) |
| Delivery labels | mine `delivered` and `read` (to record the overstatement) | clocks |
| Error | `error` canned | — |
| Disabled composer + Enable CTA | `status=needs-enable` | — |
| Sending | `sending=true` | — |
| 390 detail-only (list hidden) | conversationId set | same |

### `/channels` — `src/components/channels-page.tsx`

| State | Fixture | Mask |
|---|---|---|
| Empty list + create form, no eligible | `channels=[]`, `eligible=[]` | — |
| Eligible checkboxes + cap | `PRIVATE_GROUP_MEMBER_CAP` from `src/flags/config.ts` is 50 — fixture 3 contacts | z32 in labels if no displayName |
| Error | create error canned | — |
| Busy Creating… | `busy` | — |
| Populated rows | 2 channels | **relative time** |
| Enable CTA | not enabled | — |
| 1280 select placeholder | no `channelId` | — |

### `/channels/:id` — `src/components/channel-view.tsx`

| State | Fixture | Mask |
|---|---|---|
| Loading | `loading` | — |
| Not found | `channel=null` | — |
| Empty messages | channel + members, `messages=[]` | — |
| Populated + membership system line | group bubbles + `GROUP_MEMBERSHIP_KIND` | sender z32, clocks |
| Failed + Retry | `deliveryState: "failed"` | clocks |
| Members panel open (admin) | `showMembers=true`, add form, Remove, Leave | member z32 |
| Members panel open (non-admin) | no add/remove | — |
| Composer disabled (not member / not enabled) | `selfActive=false` or not enabled | — |
| Editing placeholder | `editingEventId` set | — |
| Error | canned | — |

### `/discover` — `src/components/discover-page.tsx`

| State | Fixture | Mask |
|---|---|---|
| Initial (not loaded) | `loaded=false`, privacy copy + Load button | — |
| Loading topics | `loading=true` | — |
| Error + Retry public topics | `error=DISCOVER_INDEX_ERROR` | — |
| Empty tags | `loaded`, `tags=[]` | — |
| Populated tags | 3 `NexusHotTag` fixtures | — |
| 1280 empty tag pane | `tag=null` | — |

### `/discover/:tag` — `src/components/tag-channel-view.tsx`

| State | Fixture | Mask |
|---|---|---|
| Loading posts | `loading` | — |
| Error wrapped | unreachable copy | — |
| Invalid tag | `That is not a usable topic label.` | — |
| Empty posts | `empty` | — |
| Unavailable rows note | `unavailable=2` | — |
| Populated posts | 2 `NexusPublicPost` | **author z32**, **relative time** |
| Disabled composer card | always | — |
| 390 detail-only | tag set | same |

### `/contacts` — `src/components/contacts-page.tsx`

| State | Fixture | Mask |
|---|---|---|
| Empty roster, signed out (no follows panel) | `ownerPubky=null` | — |
| Empty roster, follows panel off | owner set, `enabled=false` | — |
| Follows understand + enable | checkbox unchecked/checked | — |
| Follows on + note | status + Refresh/Stop | — |
| Search username mode | draft not a pubky | — |
| Search results + lookalike | hits with `lookalike: true` | **PubkyAnchors** (full z32) |
| Suggestions | `followSuggestionContacts` | anchors |
| Populated roster + badges | Mutual / Following / Added | truncated z32 row |
| Errors | canned | — |
| 1280 select placeholder | — | — |

### `/contacts/:pubky` — `src/components/contact-detail.tsx`

| State | Fixture | Mask |
|---|---|---|
| Loading | `loading` | — |
| Not in contacts | `contact=null` | **full z32** |
| Link established + trust reasons | fixture explanation | z32 |
| Payment methods list | fixture endpoints (use `formatTipIdentifierDisplay` / `payloadPreview`) | payloads |
| Payment error | `payError` | — |
| No public methods | empty | — |

### `/requests` — `src/components/requests-page.tsx`

| State | Fixture | Mask |
|---|---|---|
| Empty | `rows=[]` | — |
| Populated DM request | one row | **peer z32** |
| With group invitation | `invitations` named | — |
| Busy Accept/Decline | `busyPeer` set | — |
| Error | canned | — |

### `/profile` — `src/components/profile-page.tsx`

| State | Fixture | Mask |
|---|---|---|
| Not connected | `pubky=null` | — |
| Named + z32 + enabled label | profile displayName | **z32** |
| Unnamed | no displayName | z32 |
| Sign out busy | `busy` | — |

### `/settings` — `src/components/settings-page.tsx`

| State | Fixture | Mask |
|---|---|---|
| Default session + backup | no recovery panel | z32, homeserver |
| Recovery panel shown, checkbox off (hide disabled) | `recoveryCode` fixture **fake** code | **entire recovery code** |
| Recovery ready to dismiss | checkbox on | recovery code |
| Copied | `copied` | recovery code |
| Restore note success | canned success string | — |
| Restore/backup error | `BackupService: homeserver transport…` **and** a canned user string (two shots: current raw vs desired) | — |
| Busy Working… | `backupBusy` | — |

### `/ring-callback` — `src/components/ring-callback-page.tsx`

| State | Fixture | Mask |
|---|---|---|
| Reading | `kind: "reading"` | — |
| Invalid missing ch | already in `e2e/ring-callback.spec.ts` | — |
| Invalid missing params | — | — |
| Relay forwarded | `relay-forwarded` | — |
| Confirm | pubky fixture | **z32** |
| Done + enable link | — | z32 |
| Error | canned | — |

### Enable CTA / composer / bubbles (embedded)

Shoot as part of parent screens; extra close-ups only if 390 wrapping hides them.

| Surface | States |
|---|---|
| `EnableMessagingCta` | Connect / Enable encrypted messaging / Session offline — try again |
| `Composer` | idle, disabled, sending, attach visible, send disabled (empty draft) |
| `DmMessageBubble` | theirs, mine sent/failed, attachment slot |
| `GroupMessageBubble` | theirs with z32, deleted, emoji row, edit/delete |
| `AttachmentBubble` | sending, failed, unavailable-from-backup, decrypt, raster preview (fixture blob URL — **mask the image** or use a 1×1 PNG fixture) |
| Harness articles | one shot each of the six `/e2e/*` pages (copy-only; low design value) |

---

## 5. Recommended catalog (install-only: Playwright + existing E2E flag)

Do **not** add Chromatic, Storybook, or Loki. Based on what is already in `package.json`:

1. **Add** `app/e2e/ux-catalog/page.tsx` calling `requireE2eHarness()`, rendering a **catalog host** (new file under `src/components/` or `src/services/` — see vibeware below) that:
   - Reads `?surface=` / `?state=` query (or a static list of sub-anchors).
   - Mounts the **same production components** (`ChatsPage`, `ThreadView`, `WelcomePage`, …) with **props/fixtures**, not live `useInbox` / `useThread`.
   - For hosts that currently own data (`ChatsPageHost`, `ChannelsPage`), either export a props-only view (already true for `ChatsPage` / `ThreadView` / `WelcomePage` / `EnablePage`) or add a thin `*FixtureHost` used only from the catalog route.
   - Seeds zustand stores with fixture pubkeys; `vi` is not available in the browser — use a `window.__uxCatalog` install in `useEffect`, same pattern as `window.runDmSignup` on existing harness pages.
   - `fetch = () => Promise.reject` or a canned `NexusDiscoveryClient` injected through the existing `createDiscoverTopicsLoader` / `createTagChannelReader` / `createUsernameSearch` factories.

2. **Playwright** `e2e/ux-catalog.spec.ts`:
   - `projects` for `{ name: "pixel", use: { viewport: { width: 390, height: 844 } } }` and `{ name: "desktop", use: { viewport: { width: 1280, height: 800 } } }`.
   - For each `surface`×`state`, `page.goto("/e2e/ux-catalog?surface=…&state=…")` then `await expect(page).toHaveScreenshot({ animations: "disabled", mask: […] })`.
   - Mask with `locator` on: `[data-testid="welcomeQr"]`, `[data-testid="enableMessagingQr"]`, `[data-testid="recoveryCode"]`, `h2[data-testid="threadPeer"]`, `[data-testid="profilePubky"]`, clocks (`text-[11px]` meta or a `data-testid="msgClock"` if added later — until then mask bubble meta lines), `data-testid="pubkyAnchors"`.
   - `animations: "disabled"` covers `transition-colors` without a reduced-motion implementation.
   - Store baselines under `e2e/ux-catalog.spec.ts-snapshots/` (Playwright default).

3. **HTML report artifact**: set `reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]` in `playwright.config.ts`. CI can `npx playwright test e2e/ux-catalog.spec.ts` and `upload-artifact` `playwright-report/` plus `test-results/`. That is not in CI today; adding it is a human workflow change, not a vibeware candidate.

4. **Do not** use Vitest for pixels. Optionally later add `jsdom` + testing-library, but that is a new dependency and is out of “already installed.”

5. **Production components with fixtures** is the right split: `ChatsPage`, `ThreadView`, `EnablePage`, `WelcomePage` already take props. `ChannelsPage` / `ContactsPage` / `SettingsPage` currently fetch inside the component — catalog either wraps them with mocked `StorageService` (fragile, hits IndexedDB) or extracts a presentational child (larger diff, and for `chats-page.tsx` / `thread-view.tsx` / `welcome-page.tsx` / `enable-page.tsx` that extraction **is** the vibeware writable surface). Prefer fixture hosts that import the existing presentational files as-is.

---

## 6. Vibeware writable-path policy vs this work

Authority: `vibeware.yaml` + `docs/vibeware.md` + `scripts/check-vibeware-path-policy.mjs`.

**When it applies:** PRs whose head is `vibeware/**` or `candidate/**`, or whose HEAD contains `.vibeware/candidate`. Human PRs **skip** writable-path denial (`docs/vibeware.md` “Orchestrator vs human PRs”).

**Candidate writable_paths (only):**

- `hc-chats-ui`: `src/components/chats-page.tsx`
- `hc-thread-ui`: `src/components/thread-view.tsx`, `src/components/composer.tsx`, `src/components/message-bubble.tsx`
- `hc-onboarding-ui`: `src/components/welcome-page.tsx`, `src/components/enable-page.tsx`, `src/components/auth-qr.tsx`, `src/components/auth-url-panel.tsx`

**Forbidden (shared + per-surface)** includes session, RingConnect, payments, backup, vibeware collector, `useInbox` / `useChannel` / `useSignOut`, `chatsPageHost.tsx`, `enableActions.tsx`, `welcomeActions.tsx`, `threadActions.tsx`, `auth-url-actions.tsx`, `.github/**`, `package.json`, `package-lock.json`, `vibeware.yaml`, check scripts, and more listed in `vibeware.yaml`.

Implications for VRT:

| Change | Candidate PR? | Human PR on `main`/`feat/*`? |
|---|---|---|
| `docs/ux/**` (this inventory) | **outside_writable** (docs are not in `writable_paths`; only `docs/vibeware.md` is CODEOWNERS, not forbidden) | Allowed (skip) |
| `app/e2e/ux-catalog/page.tsx` | **outside_writable** | Allowed |
| Fixture host that only **imports** presentational writable files | Host file itself is outside writable unless it **is** one of the nine files | Allowed for humans |
| Editing `playwright.config.ts`, `e2e/*.spec.ts`, snapshots | **outside_writable**; `package.json` is **forbidden** if you add scripts | Allowed for humans; `package.json` still CODEOWNERS |
| CI step in `.github/workflows/ci.yml` | **forbidden** `.github/**` | CODEOWNERS `@BitcoinErrorLog` |

**Do not implement the catalog on a `vibeware/**` or `candidate/**` branch.** Implement on a human branch. Candidate loops may restyle `chats-page.tsx` / `thread-view.tsx` / welcome-enable QR chrome; they must not add the catalog route.

`docs/ux/` is **not** in `forbidden_paths`. It is also **not** a candidate writable path. This inventory is valid as a human/main addition.

---

## 7. Suggested first catalog slice (still not implementing)

Minimum set that covers the known UX defects:

1. Welcome QR populated + expired (390/1280)
2. SiteNav wrapping with Enable (390) vs enabled (390)
3. Chats empty + populated; thread 390 without back; delivery labels
4. Discover initial + tag 390; note rewrite is a **host** 404 (VRT the in-app tag view via catalog query, and separately document Vercel 404)
5. Settings recovery panel shown
6. Session CTA trio: nav Connect vs CTA Connect with Pubky Ring vs banner Try again
7. Disabled Discover composer + `h-8` button
8. Tab lock + session offline stacked

Nondeterministic globally: Geist download, OS scrollbar, CJK vs latin in fixture names, `toLocaleTimeString` without `locales: ["en-US"]` in Playwright `use`.
