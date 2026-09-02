# Feature exposure — Hypercolor web

Matrix of shipped services/capabilities versus a user-visible entry. Entry classes: **Entry nav** (SiteNav or layout chrome), **Empty-state CTA**, **Composer action**, **Settings-only**, **Hidden** (runs with no control), **Harness-only**.

Dead-code candidates include the **exact grep** run from repo root, excluding `node_modules/`, `out/`, `.next/`. Nothing in this document is a deletion instruction.

---

## 1. Capability vs UI entry

| Capability | Service / module | UI entry class | Component that exposes it | Notes |
|---|---|---|---|---|
| Paykit-connect (Ring handoff) | `src/services/RingConnect.ts`, `src/hooks/usePaykitConnect.ts`, `src/services/relayChannel.ts` | Entry nav (**Connect** → `/`) | `src/components/welcome-page.tsx`, `src/components/auth-url-panel.tsx`, `src/components/auth-url-actions.tsx` | Also EnableMessagingCta when `no-identity`/`unknown`. |
| Adopt identity | `src/services/RingConnect.ts` `adoptHandoff` | Empty-state CTA (Continue on welcome / ring-callback) | `src/components/welcome-page.tsx`, `src/components/ring-callback-page.tsx` | Not in SiteNav. |
| Enable messaging / Ring grant | `src/hooks/useAuthUrl.ts`, `src/services/link/session.ts`, `src/services/link/provisionReceiver.ts`, `src/lib/capabilities.ts` | Entry nav (**Enable** → `/enable`) | `src/components/enable-page.tsx`, `src/components/enable-messaging-cta.tsx` | CTA label ≠ nav label (see `docs/ux/state-and-copy.md`). |
| Session restore on load | `src/components/session-bootstrap.tsx`, `src/services/link/session.ts` `restoreSessionOnLoad` | Hidden | No control; `SessionBanner` only for `unknown` / `session-offline` | |
| Session retry | `src/components/session-banner.tsx` | Empty-state CTA (**Try again**) | Session banner; Enable page **Try again** when `offline` | Nav still says **Enable** while offline. |
| Tab lock | `src/services/tabLock.ts` | Empty-state CTA (**Take over**) | `src/components/tab-lock-banner.tsx` | Blocks writer in this tab until takeover. |
| DM inbox | `src/hooks/useInbox.ts`, `src/stores/inboxStore.ts`, `src/lib/inbox.ts`, `src/services/link/LinkService.ts` | Entry nav **Chats** | `src/components/chats-page.tsx` | `inbox.loading` is not passed into the page. |
| Start DM / add peer from chats | `src/services/contacts/addManualContact.ts` | Empty-state CTA (**New chat**) | `src/components/chats-page.tsx` | Same as empty hint “Start a new chat from the field above.” |
| Send DM text | `src/hooks/useThread.ts` → `LinkService.sendDm` | Composer action **Send** | `src/components/composer.tsx`, `src/components/thread-view.tsx` | Disabled unless `isMessagingEnabled`. |
| Attach file (DM / group) | `src/services/attachments/sendAttachment.ts`, `src/services/attachments/AttachmentService.ts` | Composer action **`+`** (`aria-label="Attach file"`) | `src/components/composer.tsx` | Character plus, not lucide. |
| Decrypt / view attachment | `src/services/attachments/AttachmentService.ts`, `src/services/KeyStore.ts` | Empty-state CTA (**Decrypt**) on the bubble | `src/components/attachment-bubble.tsx` | |
| Retry failed send | `src/hooks/useThread.ts` `retryFailed` / `useChannel` | Empty-state CTA **Retry** on bubble | `src/components/message-bubble.tsx` | |
| Private groups | `src/services/group/GroupService.ts` | Entry nav **Channels** | `src/components/channels-page.tsx` | Create form is on the list, not Settings. |
| Create private group | `GroupService.createChannel` | Empty-state CTA **Create group** | `src/components/channels-page.tsx` | Requires established links. |
| Group send / attach / edit / delete / react | `src/hooks/useChannel.ts`, `GroupService` | Composer **Send** / **`+`**; bubble Edit/Delete/emoji | `src/components/channel-view.tsx`, `src/components/message-bubble.tsx` | Emoji row has no `aria-label`. |
| Group members add/remove/leave | `GroupService.addMember` / `removeMember` / `leaveChannel` | Settings-like in-thread panel (not Settings route) | `src/components/channel-view.tsx` Members toggle | |
| Public channels (graph publish) | Called out in `src/components/channels-page.tsx` copy; `GroupServiceError` `"public-only"` | **Hidden** / refused | “Public channels are not available on web.” Tag view posting disabled. | |
| Public Discover (Nexus hot tags / posts) | `src/services/nexus/tagChannel.ts`, `src/services/nexus/NexusDiscoveryClient.ts` | Entry nav **Discover** | `src/components/discover-page.tsx` | Load is opt-in (`Load public topics`). No SW shell. |
| Public post compose | — | Composer-shaped **disabled** control | `src/components/tag-channel-view.tsx` | Not a real composer action. |
| Contacts roster | `src/services/StorageService.ts` `getAllContacts` | Entry nav **Contacts** | `src/components/contacts-page.tsx` | |
| Add by pubky | `src/services/contacts/addManualContact.ts` | Empty-state CTA **Add contact** / **Add by pubky** | `src/components/contacts-page.tsx` | |
| Username search (Nexus) | `src/services/contacts/usernameSearch.ts` | Empty-state CTA **Search username** | `src/components/contacts-page.tsx` | Explicit privacy copy that search hits the public index. |
| Follows import | `src/services/contacts/followsImport.ts`, `followsImportPreference.ts`, `homeserverFollows.ts` | Empty-state CTA on Contacts (not Settings) | `src/components/follows-import-panel.tsx` | |
| Message requests / accept / decline | `src/services/link/LinkService.ts` `acceptMessageRequest` / `declineMessageRequest`, `src/services/link/wotGate.ts` | Entry nav **Requests** | `src/components/requests-page.tsx` | Also Chats/Contacts header links. |
| Trust score | `src/services/TrustEngine.ts` | Hidden on lists (sort only); visible on detail | `src/components/contact-detail.tsx` | Copy: sorting only, never blocks delivery. |
| Read-only peer payment methods | `src/services/link/PaykitLinkWeb.ts` `listPaymentMethods` / `getPaymentList` | Contact detail section (not nav, not composer) | `src/components/contact-detail.tsx` | Copy: “This app does not send payments.” |
| Payment request / accept / reject / cancel / proof **compose** | `src/types/payment.ts` builders, `src/services/payments/applyPaymentInbound.ts` (inbound only) | **Harness-only** for writes; **Hidden** inbound apply | No product screen. Harness: `src/components/payments-harness-page.tsx` | Inbox preview string `"Payment"` (`src/lib/inbox.ts`, `src/services/StorageService.ts` `conversationPreview`). Thread has no payment card; `getLinkMessagesForConversation` does not filter payment kinds. |
| Private payment list send/receive | `src/services/payments/paymentsHarness.ts` | **Harness-only** | `app/e2e/payments-harness/page.tsx` | |
| Encrypted backup export | `src/services/backup/BackupService.ts` | **Settings-only** | `src/components/settings-page.tsx` **Backup now** | |
| Restore from recovery code | `BackupService.restoreBackup` | **Settings-only** | `src/components/settings-page.tsx` | |
| Sign out | `src/hooks/useSignOut.ts`, `src/services/link/session.ts` `signOut` | Settings-only **and** Profile | `src/components/settings-page.tsx`, `src/components/profile-page.tsx`, Enable page when enabled | Not in SiteNav. |
| PWA register / install evidence | `src/components/pwa-register.tsx`, `public/sw.js` | Hidden | No install button | `beforeinstallprompt` / `appinstalled` → vibeware. Skipped on `/e2e` and non-production. |
| Vibeware evidence / assignment | `src/services/vibeware/**` | Hidden | Chats empty-state hint swap via `fetchAssignment` in `chatsPageHost.tsx` | Writable UI must not import collector; host does. |
| Retry queue drain | `src/services/RetryQueue.ts`, `LinkService` | Hidden | No queue UI | |
| SQLite / KeyStore | `src/db/**`, `src/services/KeyStore.ts` | Hidden | No storage UI | |
| Owner-tree roundtrip | `src/services/link/ownerRoundtrip.ts` | **Harness-only** | `src/components/owner-roundtrip-page.tsx` | |
| DM staging harness | `src/services/link/dmHarness.ts` | **Harness-only** | `src/components/dm-harness-page.tsx` | |
| Groups staging harness | `src/services/link/groupHarness.ts` | **Harness-only** | `src/components/groups-harness-page.tsx` | |
| Attachment staging harness | `src/services/attachments/attachmentRoundtrip.ts` | **Harness-only** | `src/components/attachment-roundtrip-page.tsx` | |
| Backup staging harness | `src/services/backup/backupHarness.ts` | **Harness-only** | `src/components/backup-harness-page.tsx` | |
| Staging signup | `src/services/link/stagingSignup.ts` | **Harness-only** (imported by attach/backup harnesses) | No product UI; tokens must not render | |

### Payment compose — product-unreachable

Grep of `src/`, `app/`, `e2e/` for a product payments route or composer (excluding types, inbound apply, and the harness):

- Product UI files that mention payments as a **user action**: `src/components/contact-detail.tsx` (read-only list + “does not send payments”), `src/components/payments-harness-page.tsx` (e2e), `app/e2e/payments-harness/page.tsx`, `e2e/payments-staging.spec.ts`.
- No `/payments` route under `app/`.
- `Composer` (`src/components/composer.tsx`) has draft + optional attach + Send only.
- There is **no** `PaymentService` implementation file. The name appears only in a comment in `src/types/payment.ts`.

---

## 2. Empty-state CTAs vs nav (summary)

| Screen | Empty copy | CTA on that screen | Nav already exposes? |
|---|---|---|---|
| Chats | “No conversations yet.” + hint | New chat form; Enable CTA | Chats nav yes |
| Channels | “No channels yet.” | Create group form; Enable CTA | Channels nav yes |
| Discover | “The public index has no hot tags right now.” / load button | **Load public topics** | Discover nav yes |
| Contacts | “No contacts yet.” | Search/add; follows import | Contacts nav yes |
| Requests | “No pending requests.” | None | Requests nav yes |
| Thread none selected | “Select a conversation.” | None | — |
| Thread empty messages | “No messages yet. Send the first one.” | Composer | — |
| Channel none selected | “Select a channel.” | None | — |
| Tag none selected | “Open a public topic…” | None | — |

---

## 3. Dead-code candidates (do not delete here)

Each candidate is unused **in product source** after a repo grep excluding `node_modules/`, `out/`, `.next/`. `vendor/` is called out when it is the only extra hit.

### 3.1 `lucide-react` declared, never imported

`package.json` lists `"lucide-react": "^1.37.0"`. `components.json` sets `"iconLibrary": "lucide"`.

```text
rg -n --glob '!node_modules/**' --glob '!out/**' --glob '!.next/**' --glob '!package-lock.json' 'lucide'
```

Hits:

```text
package.json:37:    "lucide-react": "^1.37.0",
components.json:20:  "iconLibrary": "lucide"
```

Zero `from "lucide-react"` in `src/` or `app/`. Composer attach uses the character `+` (`src/components/composer.tsx`).

### 3.2 create-next-app leftover SVGs in `public/`

Files present: `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`.

```text
rg -n --glob '!node_modules/**' --glob '!out/**' --glob '!.next/**' --glob '!package-lock.json' 'file\.svg|globe\.svg|next\.svg|vercel\.svg|window\.svg'
```

**Zero hits.** Product icons actually referenced: `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`, `public/manifest.webmanifest` (`app/layout.tsx`, `public/sw.js` `SHELL`).

### 3.3 `paymentPreviewBody`

```text
rg -n --glob '!node_modules/**' --glob '!out/**' --glob '!.next/**' --glob '!vendor/**' 'paymentPreviewBody'
```

Hit: `src/types/payment.ts:987` (definition + switch). Inbox/storage use the literal `'Payment'` / `"Payment"` instead (`src/lib/inbox.ts`, `src/services/StorageService.ts`). Vendor pin duplicates the type file; still unused by UI.

### 3.4 `CHAT_RECEIPT_KIND` / `CHAT_REACTION_KIND` (DM)

```text
rg -n --glob '!node_modules/**' --glob '!out/**' --glob '!.next/**' --glob '!*.test.ts' --glob '!vendor/**' 'CHAT_RECEIPT_KIND'
```

Hit: `src/types/link.ts` definition and comment “No receipt logic exists yet.”

```text
rg -n --glob '!node_modules/**' --glob '!out/**' --glob '!.next/**' --glob '!*.test.ts' --glob '!vendor/**' 'CHAT_REACTION_KIND'
```

Hit: `src/types/link.ts` definition and comment “No reaction logic exists yet.” Group reactions use `GROUP_REACTION_KIND` in `src/types/group.ts` / `src/lib/inbox.ts`, not this DM kind.

### 3.5 `recoveryCodeDisplayState`

```text
rg -n --glob '!node_modules/**' --glob '!out/**' --glob '!.next/**' 'recoveryCodeDisplayState'
```

Hits: `src/lib/backup-gate.ts` (definition) and `src/lib/backup-gate.test.ts`. Settings UI uses `canDismissRecoveryCode` only (`src/components/settings-page.tsx`).

### 3.6 `PaymentService` symbol

```text
rg -n --glob '!node_modules/**' --glob '!out/**' --glob '!.next/**' --glob '!vendor/**' 'PaymentService'
```

Hit: comment in `src/types/payment.ts` (“see PaymentService”). No `src/services/payments/PaymentService.ts`. Directory is `applyPaymentInbound.ts`, `endpointValidation.ts`, `paymentsHarness.ts`, `proofVerify.ts`.

### 3.7 shadcn primitives vs `components.json`

`components.json` is a full shadcn new-york config. Actual `src/components/ui/`:

- `button.tsx`
- `input.tsx`

No `dialog`, `sheet`, `dropdown-menu`, `skeleton`, `tooltip`, `sonner`, `avatar`. Confirmed by directory listing and `from "@/components/ui/"` imports (only button + input).
