# Web VRT Runner

Wave 4b adds a harness-gated catalog at `/e2e/ux-catalog?scene=<id>`.
`app/e2e/ux-catalog/page.tsx` gates the route and dynamic catalog import on the
compile-time `__HYPERCOLOR_E2E_HARNESS__` constant, so production builds without
`NEXT_PUBLIC_E2E_HARNESS=1` return 404 and should contain no catalog component
bytes.

Run:

```bash
rm -rf out-e2e
npm run test:e2e:static
```

The command builds the static harness export, serves `out-e2e`, runs the existing
static e2e proofs, then runs `e2e/ux-catalog.spec.ts` in:

| Project | Viewport | Purpose |
| --- | --- | --- |
| `chromium-mobile-pixel` | 390 × 844 | mobile-web pixel baseline |
| `chromium-desktop-pixel` | 1280 × 800 | desktop pixel baseline |

Every scene must render `data-vrt-scene="<id>"` on the captured production
surface root, and every scene must contain at least one
`data-surface="<production-component-name>"` marker from the production
component it mounts. Baselines are committed under `e2e/vrt-baselines/`.
The spec captures only the marked surface with `locator.screenshot()` and checks
that no two different scene PNGs in the same project are at least 99%
pixel-identical. Size mismatches are compared by shared content plus a size
penalty; they are never skipped.

Fixtures are synthetic only. The catalog blocks `fetch` while mounted, seeds
only deterministic invented identities, and never uses live credentials.

## Integrity Waivers

The near-identity allowlist is intentionally small and mirrored in
`scripts/ux-vrt-integrity.mjs`.

- `chrome-nav-enabled` / `chrome-nav-needs-enable`: both mount the production
  `SiteNav`; in the cropped chrome capture the shared route links dominate, and
  the intentional difference is the session CTA plus request badge.
- `chrome-nav-enabled` / `chrome-nav-no-identity`: both mount the production
  `SiteNav`; in the cropped chrome capture the shared route links dominate, and
  the intentional difference is the session CTA plus request badge.

A future waiver must name both scene ids, explain why the two production states
are intentionally visually identical, and be mirrored in
`scripts/ux-vrt-integrity.mjs`.

## Coverage

The current registry has 56 scenes. It covers 53 of the 111 matrix cells plus
three embedded close-ups (`composer-menu`, `attachment-failed`,
`attachment-unavailable`). The remaining 58 cells are explicitly waived for this
round because they require a broader presenter extraction or production state
that does not exist yet; they remain final-pass work.

| Section | Cells | Scenes | Waivers |
| --- | ---: | ---: | ---: |
| Shared chrome | 8 | 5 | 3 |
| `/` Welcome | 6 | 5 | 1 |
| `/enable` | 7 | 4 | 3 |
| `/chats` list | 11 | 4 | 7 |
| `/chats/:id` thread | 9 | 5 | 4 |
| `/channels` | 7 | 2 | 5 |
| `/channels/:id` | 10 | 3 | 7 |
| `/discover` | 6 | 2 | 4 |
| `/discover/:tag` | 8 | 2 | 6 |
| `/contacts` | 10 | 4 | 6 |
| `/contacts/:pubky` | 6 | 2 | 4 |
| `/requests` | 5 | 4 | 1 |
| `/profile` | 4 | 3 | 1 |
| `/settings` | 7 | 4 | 3 |
| `/ring-callback` | 7 | 4 | 3 |
| **Total** | **111** | **53** | **58** |

Waived cells: shared chrome session unknown, both banners stacked, `/e2e` chrome;
Welcome authenticated strip; Enable expired, error, sign out visible; Chats empty
control hint, empty candidate hint, start-chat error, starting disabled, inbox
error, pending requests badge, 1280 empty detail; Thread invalid id, loading,
delivery labels, sending; Channels eligible checkboxes/cap, error, busy create,
enable CTA, 1280 select placeholder; Channel loading, not found, failed retry,
members non-admin, composer disabled, editing placeholder, error; Discover
loading topics, error retry, empty tags, 1280 empty tag pane; Tag loading posts,
error wrapped, invalid tag, unavailable rows, disabled composer card, 390
detail-only; Contacts empty signed out, empty follows-off, follows on note,
search username mode, suggestions, errors; Contact detail loading, payment
methods, payment error, no public methods; Requests error; Profile sign-out
busy; Settings recovery checkbox off, recovery ready, copied; Ring callback
invalid missing params, relay forwarded, invalid missing `ch` covered in
`e2e/ring-callback.spec.ts`.
