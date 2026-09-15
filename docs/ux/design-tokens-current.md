# Design tokens as implemented — Hypercolor web

Superseded by `docs/ux/design-tokens-web.md` in Wave 4b. This file is retained
as the pre-migration audit record and raw-value source for the mapping table.

Source of truth for colors, radii, type, shadcn, icons, PWA assets, and accessibility gaps. Counts are from `src/**` and `app/**` only unless noted. `vendor/`, `node_modules/`, `out/`, `.next/` excluded.

---

## 1. CSS variables (`app/globals.css`)

`:root`:

| Variable | Value |
|---|---|
| `--radius` | `0.5rem` |
| `--background` | `oklch(0.145 0 0)` |
| `--foreground` | `oklch(0.985 0 0)` |
| `--card` | `oklch(0.205 0 0)` |
| `--card-foreground` | `oklch(0.985 0 0)` |
| `--primary` | `oklch(0.922 0 0)` |
| `--primary-foreground` | `oklch(0.205 0 0)` |
| `--secondary` | `oklch(0.269 0 0)` |
| `--secondary-foreground` | `oklch(0.985 0 0)` |
| `--muted` | `oklch(0.269 0 0)` |
| `--muted-foreground` | `oklch(0.708 0 0)` |
| `--accent` | `oklch(0.269 0 0)` |
| `--accent-foreground` | `oklch(0.985 0 0)` |
| `--border` | `oklch(0.269 0 0)` |
| `--input` | `oklch(0.269 0 0)` |
| `--ring` | `oklch(0.556 0 0)` |
| `--brand` | `#7c3aed` |

`@theme inline` maps those to `--color-*`, sets `--radius-sm: calc(var(--radius) - 4px)`, `--radius-md: var(--radius)`, `--radius-lg: calc(var(--radius) + 4px)`, `--font-sans: var(--font-geist-sans)`, `--font-mono: var(--font-geist-mono)`.

`body` uses `background: var(--background); color: var(--foreground); font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif`.

There is **no** `.dark` / light `:root` pair. The sheet is dark-only. `app/layout.tsx` `viewport.themeColor` is `#0a0a0a` (hex, not the oklch background).

No `@media (prefers-reduced-motion)` and no `motion-reduce:` / `motion-safe:` classes anywhere in `src/` or `app/` (grep: zero hits).

---

## 2. Raw color literals in `src/**` and `app/**`

### 2.1 Hex

| Literal | Count | Files |
|---|---|---|
| `#7c3aed` | 1 | `app/globals.css` (`--brand`) |
| `#0a0a0a` | 1 | `app/layout.tsx` `themeColor` |

Related hex **outside** `src/`+`app/` (assets): `public/manifest.webmanifest` `background_color` / `theme_color` `#0a0a0a`; `public/icon.svg` fill `#0a0a0a` and `#7c3aed`.

### 2.2 oklch (all in `app/globals.css`)

| Literal | Count |
|---|---|
| `oklch(0.269 0 0)` | 5 (`--card` is 0.205; 0.269 is secondary/muted/accent/border/input) |
| `oklch(0.985 0 0)` | 4 |
| `oklch(0.205 0 0)` | 2 |
| `oklch(0.145 0 0)` | 1 |
| `oklch(0.922 0 0)` | 1 |
| `oklch(0.708 0 0)` | 1 |
| `oklch(0.556 0 0)` | 1 |

No `rgb()` / `rgba()` in `src/` or `app/`.

### 2.3 Tailwind palette classes (not CSS variables)

| Class | Count | Typical use |
|---|---|---|
| `text-red-400` | 14 | error paragraphs |
| `text-brand` | 9 | links, avatars |
| `bg-brand` | 3 | unread pill, mine bubbles |
| `text-white` | 3 | on `bg-brand` |
| `text-white/70` | 2 | bubble meta on brand |
| `bg-white` | 1 | `src/components/auth-qr.tsx` QR pad |
| `text-amber-400` | 1 | lookalike warning (`contacts-page.tsx`) |

Other non-token alpha:

| Class | Count | File |
|---|---|---|
| `text-foreground/80` | 1 | `src/components/auth-url-actions.tsx` |
| `hover:bg-accent/40` | 4 | chats, channels, discover, contacts row hover |
| `bg-background/40` | 1 | `src/components/attachment-bubble.tsx` |
| `bg-accent/40` (button hover via variant) | in `src/components/ui/button.tsx` ghost/outline | |

Semantic token classes (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, `border-border`, `bg-secondary`, `bg-primary`, …) are the default surface language and are not counted as “raw” palette.

---

## 3. Radius and size literals

### 3.1 Radius

| Class | Count (`src`+`app`) | Where |
|---|---|---|
| `rounded-md` | 17 | buttons, cards, inputs, forms |
| `rounded-full` | 5 | avatars, unread, relationship badges |
| `rounded-2xl` | 2 | DM/group bubbles (`message-bubble.tsx`) |
| `rounded-xl` | 1 | QR chrome (`auth-qr.tsx`) |
| `rounded` | 1 | emoji reaction chips |

Token radii `--radius-sm/md/lg` are defined but components mostly hardcode `rounded-md` (shadcn button maps to that). QR SVG `public/icon.svg` uses `rx="96"` on a 512 viewBox (~19% rounding), not `--radius`.

### 3.2 Control heights (44px target)

| Class | Count | File | CSS px @ 16px root |
|---|---|---|---|
| `h-9` | 3 | `src/components/ui/button.tsx` default + icon; `src/components/ui/input.tsx` | **36px** |
| `h-8` | 2 | `button.tsx` `size="sm"`; `src/components/tag-channel-view.tsx` disabled post button | **32px** |
| `h-10` | 2 | chats avatar; button `lg` (unused in product calls) | 40px |
| `h-20` / `w-20` | 1 | profile avatar (`profile-page.tsx`) | 80px |
| `w-9` | 1 | button icon | 36px |
| `size-4` | 1 | button svg slot | 16px |

`Button` `size="sm"` (`h-8`) is used in chats, channels, channel members, contacts, follows, requests, settings recovery, discover load, enable CTA, session/tab banners, attachment decrypt, message Retry — **27 `size="sm"` call sites** across those files.

Composer attach is `size="icon"` → `h-9 w-9` (36px). Group emoji buttons are `rounded px-1 text-xs` with no min height (`message-bubble.tsx`).

### 3.3 Layout sizes (selected, from class scan)

| Class | Count | Notes |
|---|---|---|
| `min-h-[70vh]` | 4 | master/detail pages |
| `min-h-[28rem]` | 2 | thread + channel articles |
| `min-h-64` | 2 | empty detail placeholders |
| `max-w-[85%]` | 2 | bubbles |
| `max-w-5xl` | layout + banners | `app/layout.tsx` header/main; session banner |
| `max-w-3xl` | 1 | tab-lock inner |
| `px-6` | 4 | layout chrome |
| `text-[11px]` | 3 | bubble meta / group sender |
| `AUTH_QR_SIZE_PT` | 220 | `src/lib/auth-qr.ts` — img width/height, not Tailwind |

---

## 4. Type

`app/layout.tsx` loads `next/font/google` Geist + Geist_Mono as `--font-geist-sans` / `--font-geist-mono`.

Product scale in use: `text-3xl` (welcome h1), `text-2xl` (page h1s), `text-xl` (contact/tag h2), `text-lg`, `text-sm`, `text-xs`, `text-[11px]`, `font-mono`, `font-semibold`, `tracking-tight`, `tracking-wide`, `uppercase`.

---

## 5. shadcn config vs tree

`components.json`:

- style `new-york`
- `rsc: true`, `tsx: true`
- tailwind `css`: `app/globals.css`, `baseColor`: `neutral`, `cssVariables`: true
- aliases `@/components`, `@/lib/utils`, `@/components/ui`
- `iconLibrary`: `lucide`

Present under `src/components/ui/`:

| File | Exports |
|---|---|
| `src/components/ui/button.tsx` | `Button`, `buttonVariants` — variants default/secondary/outline/ghost/link; sizes default/sm/lg/icon; `@radix-ui/react-slot` |
| `src/components/ui/input.tsx` | `Input` |

Missing relative to a stock new-york kit (and to `iconLibrary`): no lucide usage, no Dialog, Sheet, Dropdown, Popover, Skeleton, Avatar, Textarea, Label, Checkbox primitive (native `<input type="checkbox">` is used in settings + follows + channel member list).

`src/lib/utils.ts` is the standard `cn` = `twMerge(clsx(...))`.

---

## 6. Icon usage

| Kind | Implementation |
|---|---|
| Attach | Character `+` in `src/components/composer.tsx` (`size="icon"`) |
| Chat avatar | First letter of title (`src/components/chats-page.tsx`) |
| Profile avatar | First letter (`src/components/profile-page.tsx`) |
| Reactions | Unicode emoji in `src/components/message-bubble.tsx` |
| Brand | CSS `text-brand` / `bg-brand`, not an icon font |
| lucide-react | **unused** (see `docs/ux/feature-exposure.md` grep) |

No `<svg>` icons in `src/components` except the generated QR `<img>`.

---

## 7. Favicon / manifest / PWA assets

| Asset | Path | Measured size |
|---|---|---|
| Favicon | `app/favicon.ico` | ICO, 4 images; `file` reports 16×16 and 32×32 32-bit (plus two additional directory entries). 25931 bytes. |
| SVG icon | `public/icon.svg` | viewBox `0 0 512 512`; `role="img"` `aria-label="Hypercolor"`; 216 bytes |
| PNG 192 | `public/icon-192.png` | **192×192**, 8-bit RGB, 547 bytes |
| PNG 512 | `public/icon-512.png` | **512×512**, 8-bit RGB, 1881 bytes |
| Apple touch | `public/apple-touch-icon.png` | **192×192** (not 180×180), 547 bytes — same tiny payload as icon-192 |
| Manifest | `public/manifest.webmanifest` | name/short_name `Hypercolor`; `start_url` `/`; `display` `standalone`; colors `#0a0a0a`; icons svg `any` + 192 + 512, **`purpose`: `any` only (no `maskable`)** |
| SW | `public/sw.js` | precaches `/manifest.webmanifest` and `/icon.svg` only |

`app/layout.tsx` `metadata.icons` points at `/icon.svg`, `/icon-192.png`, `/icon-512.png`, apple `/apple-touch-icon.png`. There is **no** `app/icon.tsx` / `app/apple-icon.png`.

Create-next-app leftovers (unreferenced): `public/file.svg` (391 B), `public/globe.svg` (1035 B), `public/next.svg` (1375 B), `public/vercel.svg` (128 B), `public/window.svg` (385 B).

PNG payloads of 547 / 1881 bytes for 192 / 512 RGB are consistent with a flat purple-on-black mark (same as the SVG), not a detailed bitmap.

---

## 8. Accessibility gaps

### 8.1 Skip link

`app/layout.tsx` has no skip-to-main link. First tab stop is inside `SiteNav` after banners.

### 8.2 Landmarks

- `<nav>` on SiteNav (unnamed: no `aria-label`)
- `<main>` wraps pages
- `<header>` for brand + nav
- Banners use `role="status"` (tab lock, session) — good, but there is **no `aria-live`** / **`aria-busy`** anywhere (`src/`+`app/` grep: zero)

Loading copy (`Loading messages…`, `Loading channel…`, `Loading contact…`, `Loading public posts…`, `Checking session…`) is ordinary `<p>`, not an announced live region. Composer `sending` / buttons `disabled` have no `aria-busy`.

### 8.3 Unnamed or weakly named controls

| Control | File | Accessible name |
|---|---|---|
| SiteNav `<nav>` | `site-nav.tsx` | none (links themselves have text) |
| SiteNav links | same | text content (OK) |
| Attach `<input type="file" class="sr-only">` | `composer.tsx` | **no** `aria-label` on the input (the sibling button has `Attach file`) |
| Attach button | `composer.tsx` | `Attach file` (OK) |
| Emoji reaction `<button>` | `message-bubble.tsx` | emoji character only; no `aria-label` like “React with thumbs up” |
| Edit / Delete | `message-bubble.tsx` | text (OK) |
| Channel member checkboxes | `channels-page.tsx` | wrapped in `<label>` with name or pubky (OK) |
| Recovery / follows checkboxes | settings / follows | label text (OK) |
| Chat row | `chats-page.tsx` | `aria-label={row.title}` (group name or peer; may be full z32) |
| Contact row | `contacts-page.tsx` | `aria-label={contact.pubky}` (full z32, not display name) |
| Channel row / discover row | channels / discover | **no** `aria-label`; name is in the link text |
| QR `<div>` | `auth-qr.tsx` | `aria-label="Authorization QR code"` plus `img alt` (duplicate) |
| Copy / Open Ring | `auth-url-actions.tsx` | `aria-label` matches visible label |
| Disabled public post | `tag-channel-view.tsx` | text `Write a public post` |
| Take over / Try again | banners | text (OK) |

### 8.4 Hit targets `< 44px`

- All `size="sm"` buttons: **32px** height.
- Default Button and Input: **36px**.
- Icon attach: **36×36**.
- Emoji chips: `text-xs` + `px-1` — well under 44px.
- SiteNav text links: line-height of `text-sm` without extra padding; wrapping rows help spacing (`gap-y-2` = 8px) but each link is still a text run.
- Relationship badges and unread pill are not controls.

### 8.5 Focus

Buttons/inputs use `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`. There is **no focus restoration** after a “panel” closes because there are no dialogs; recovery-panel hide leaves focus on the hide button which then unmounts (focus can dump to body). Members toggle does not move focus into the section.

### 8.6 Reduced motion

None. `transition-colors` on Button/Input still runs for users who prefer reduced motion.

### 8.7 Contrast pairs to measure (do not claim pass/fail without a meter)

Measure these **foreground / background** pairs in the running app (oklch + hex + Tailwind defaults):

| Foreground | Background | Where |
|---|---|---|
| `--foreground` `oklch(0.985 0 0)` | `--background` `oklch(0.145 0 0)` | body, main |
| `--muted-foreground` `oklch(0.708 0 0)` | `--background` `oklch(0.145 0 0)` | helper copy |
| `--muted-foreground` `oklch(0.708 0 0)` | `--card` `oklch(0.205 0 0)` | cards, banners, forms |
| `--brand` `#7c3aed` | `--background` `oklch(0.145 0 0)` | SiteNav Enable/Connect, Requests links |
| `--brand` `#7c3aed` | `--secondary` `oklch(0.269 0 0)` | letter avatars |
| `text-white` `#fff` | `bg-brand` `#7c3aed` | mine bubbles, unread pill |
| `text-white/70` | `bg-brand` `#7c3aed` | bubble timestamps (11px) |
| `text-red-400` (Tailwind red-400 ≈ `#f87171`) | `--background` / `--card` | errors |
| `text-amber-400` (≈ `#fbbf24`) | `--card` | lookalike warning |
| `--primary-foreground` `oklch(0.205 0 0)` | `--primary` `oklch(0.922 0 0)` | default Button (near-white fill on dark page) |
| `--muted-foreground` at `opacity-60` | `--secondary` | disabled “Write a public post” |
| `--muted-foreground` | `--background` at `text-xs` / `text-[11px]` | timestamps, homeserver line |
| `text-foreground/80` | `--background` | auth URL paragraph |
| QR black modules | `bg-white` pad | `auth-qr.tsx` (high contrast by design) |
| `--muted-foreground` | `--background` for **underline-only** nav links | inactive SiteNav |

Likely stress points (to measure, not asserted): `#7c3aed` on `oklch(0.145)` for small underlined text; `oklch(0.708)` on `oklch(0.145)` at `text-xs`; `text-white/70` on `#7c3aed` at 11px; red-400 on dark for small errors; disabled `opacity-50` / `opacity-60` on already-muted text.

### 8.8 Other

- No skeleton placeholders (text “Loading…” only).
- No `lang` mismatch (`<html lang="en">` is set).
- Checkboxes in recovery/follows are  native, typically 16px, inside a text label (label hit area is larger than the box).
- Contact `aria-label` is the raw z32, so SR users hear 52 characters per row.
