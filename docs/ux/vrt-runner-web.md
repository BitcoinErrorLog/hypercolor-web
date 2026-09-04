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

Baseline updates are not a gate. When a visual change is intentional, refresh
the committed PNGs explicitly:

```bash
rm -rf out-e2e
npm run build:e2e:static
PLAYWRIGHT_STATIC=1 npx playwright test e2e/ux-catalog.spec.ts --update-snapshots
npm run vrt:report
```

The normal gate must run without `--update-snapshots`; it compares against the
committed baselines with `maxDiffPixels: 24`. The budget is absolute rather
than ratio-based so a single missing avatar initial, badge digit, or short icon
cannot be swallowed by a larger desktop viewport.

The command builds the static harness export, serves `out-e2e`, runs the existing
static e2e proofs, then runs `e2e/ux-catalog.spec.ts` in:

| Project | Viewport | Purpose |
| --- | --- | --- |
| `chromium-mobile-pixel` | 390 × 844 | mobile-web pixel baseline |
| `chromium-desktop-pixel` | 1280 × 800 | desktop pixel baseline |

Every scene must render `data-vrt-scene="<id>"` on the captured production
surface root, and every scene must contain at least one
`data-surface="<expected-production-component-name>"` marker from the production
component declared in `scenes.ts`. Baselines are committed under
`e2e/vrt-baselines/`. The spec captures only the marked surface with
`toHaveScreenshot()` and checks that no two different scene PNGs in the same
project are at least 99%
pixel-identical. Size mismatches are compared by shared content plus a size
penalty; they are never skipped.

Fixtures are synthetic only. The catalog blocks live `fetch` while mounted
but allows same-origin static runtime assets, seeds only deterministic invented
identities, and never uses live credentials.
The catalog passes a fixed 2026-09-03T12:00:00Z `now` value into the production
surfaces that render relative-time labels or payment-expiry state, so those
labels remain deterministic without freezing browser timers.

## Integrity Waivers

The near-identity allowlist is mirrored in `scripts/ux-vrt-integrity.mjs` and
printed by the Playwright gate. Every entry must name both scene ids and state
the real production difference that remains visible in the baseline:
channel editing/populated composer variants, private-channel busy create,
public-topic loading/error/unavailable status rows, public-topic
directory error, nav enabled/needs-enable badge count, thread empty/loading,
and payment requested/expired/proof/failed/unverified status rows. A future
waiver must meet the same standard and be mirrored in the script.

Seven matrix cells remain legitimate hard waivers:

- Shared chrome `/e2e` chrome: `SiteNav` returns `null` on `/e2e`.
- Shared chrome session unknown: `SessionBanner` intentionally renders nothing.
- Contact detail payment methods list: `ContactDetail` has no payment UI.
- Contact detail payment error: same missing product surface.
- Contact detail no public methods: same missing product surface.
- Ring callback invalid missing `ch`: covered by `e2e/ring-callback.spec.ts`.
- Contacts follows-on note: follows-import preference is service-backed and not
  presenter-injectable in the catalog.

## Coverage

The current registry has 86 scenes. It covers roughly 83 of the 111 matrix cells
plus three embedded close-ups (`composer-menu`, `attachment-failed`,
`attachment-unavailable`). The seven hard waivers above are intentional; the
remaining uncovered cells are post-release coverage work, not duplicate-gate
waivers.

| Section | Cells | Scenes | Waivers |
| --- | ---: | ---: | ---: |
| Shared chrome | 8 | 5 | 2 |
| `/` Welcome | 6 | 6 | 0 |
| `/enable` | 7 | 7 | 0 |
| `/chats` list | 11 | 7 | 0 |
| `/chats/:id` thread + payments | 9 | 12 | 0 |
| `/channels` | 7 | 7 | 0 |
| `/channels/:id` | 10 | 8 | 0 |
| `/discover/:tag` | 8 | 5 | 0 |
| `/contacts` | 10 | 4 | 1 |
| `/contacts/:pubky` | 6 | 2 | 3 |
| `/requests` | 5 | 5 | 0 |
| `/profile` | 4 | 4 | 0 |
| `/settings` | 7 | 5 | 0 |
| `/ring-callback` | 7 | 6 | 1 |
| **Total** | **111** | **83** | **7** |
