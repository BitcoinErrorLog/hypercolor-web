# Web Design Tokens

Status: Wave 4b web token mapping from the owner-approved mobile contract.

The canonical values live as CSS custom properties in `app/globals.css`. Tailwind
theme colors, radii, font roles, icon sizes, motion durations, and easing values
map to those variables; component code uses token classes and the shared utility
classes in `globals.css`.

## Token Counts

| Set | Count |
| --- | ---: |
| Semantic color tokens | 38 |
| Spacing tokens | 8 |
| Radius tokens | 7 |
| Type roles | 13 |
| Icon sizes | 4 |
| Measure tokens | 3 |
| Motion durations | 4 |
| Easing tokens | 3 CSS-facing roles |
| Text-on-surface pairs under test | 30 |

## Raw Value Mapping

| Raw value | Web token | Action |
| --- | --- | --- |
| `#7c3aed` | `--color-brand` | map |
| `#f9fafb` | `--color-textPrimary` | map |
| `#fff`, `#ffffff` | `--color-textOnBrand`, `--color-qrQuietZone` | map by role |
| `#6b7280`, `#4b5563` | `--color-textSecondary` | delete, contrast replacement |
| `#1a1a1a` | `--color-hairline`, `--color-surfaceRaised` | map by role |
| `#0a0a0a` | `--color-canvas` | map |
| `#c4b5fd` | `--color-brandMuted` | map |
| `#9ca3af` | `--color-textMuted` | map |
| `#374151` | `--color-hairlineStrong` | map |
| `#fca5a5` | `--color-danger` | map |
| `#1f2937` | `--color-well` | map |
| `#86efac` | `--color-success` | map |
| `#1f1f1f` | `--color-bubbleIncoming` | map |
| `#111`, `#111111` | `--color-surface` | map |
| `#a78bfa` | `--color-brandSoft` | map |
| `#f59e0b` | `--color-warning` | map |
| `#ef4444` | `--color-dangerStrong` | map |
| `#e9d5ff` | `--color-brandHighlight` | map |
| `#141414` | `--color-surface` | delete, one-off surface fill |
| `#fbbf24` | `--color-warningStrong` | map |
| `#1f1b2e` | `--color-surfaceBrand` | map |
| `#4c1d95` | `--color-brandDeep` | map |
| `#e5e7eb`, `#f87171`, `#d1d5db`, `#111827` | existing semantic text/surface tokens | delete, duplicate palette values |
| `rgba(0,0,0,0.6)` | `--color-overlay` | map |
| `rgba(0,0,0,0.25)` | `--color-overlaySoft` | map |
| white alpha body text | `--color-textOnBrandMuted` | delete low-contrast variants |
| white alpha UI chrome | `--color-textOnBrandUi` | map only for UI/large |
| decorative white alphas | `--color-overlayOnBrand`, `--color-overlayOnBrandFaint` | map, never text |
| chip washes | `--color-chipWarning`, `--color-chipSuccess`, `--color-chipDanger` | map |
| arbitrary `min-h`, `max-w`, `text-[11px]` classes | `.hc-master-detail`, `.hc-detail-panel`, `.hc-bubble`, `.hc-meta` | delete from components |

Proof is `scripts/design-tokens-web.test.mjs`: it computes WCAG AA for all 30
approved text-on-surface pairs and scans `src/components/**` plus `app/**`
outside `globals.css` for raw hex/rgb values, old palette classes, and arbitrary
size literals.
