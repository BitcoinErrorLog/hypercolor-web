# Web VRT Runner

Wave 4b adds a harness-gated catalog at `/e2e/ux-catalog?scene=<id>`.
`app/e2e/ux-catalog/page.tsx` calls `requireE2eHarness()`, so production builds
without `NEXT_PUBLIC_E2E_HARNESS=1` return 404 and expose no live hook.

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

Every scene must render `data-vrt-scene="<id>"` before capture. Baselines are
committed under `e2e/vrt-baselines/`. The spec checks that no two different
scene PNGs in the same project are at least 99% pixel-identical. The report
builder writes `ux-vrt-report/index.html`, grouped by journey and viewport
project, with relative image paths so it opens from disk.

Fixtures are synthetic only. The catalog blocks `fetch` while mounted and uses
fixed invented names, messages, and invalid recovery material.
