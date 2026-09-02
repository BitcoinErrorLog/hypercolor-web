# Hypercolor (web)

Static web client for **Hypercolor Encrypted Links**. Same protocol as the
mobile app at [`BitcoinErrorLog/hypercolor`](https://github.com/BitcoinErrorLog/hypercolor)
commit `6185a6a8e6bf3a52831515cb85131a7020704396`. BLE mesh is omitted.

This repo is a Next.js App Router **static export** (`output: 'export'`). The
Pubky homeserver is the backend. There are no Route Handlers that need a Node
server.

## Auth (honest)

- A **pubkyauth** session (Pubky Ring) authorizes **owner PUTs** on the
  homeserver. The identity secret stays in the signer.
- **AppCert is UKD-only.** It is not a homeserver credential and is not used
  to authenticate writes here.
- Welcome is **paykit-connect** (QR + copy). Enable Messaging is **pubkyauth**
  (QR + copy + open in Ring). `/ring-callback` completes same-device or
  POSTs public params to `httprelay.pubky.app/link/hc-<ch>`.
- `SessionHandle.exportSession()` is secret-free metadata. It is never sent
  as a Cookie header. The write credential is the homeserver HttpOnly cookie.
- Default public origin for `callback=` is `https://hypercolor.app`
  (`/ring-callback`). Override with `NEXT_PUBLIC_APP_ORIGIN`. Relay base
  override: `NEXT_PUBLIC_HTTP_RELAY`.

### Staging owner-document proof

```bash
bash /Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh
STAGING_SIGNUP_TOKEN=<token> npm run test:e2e -- e2e/owner-roundtrip.spec.ts
```

Do not commit or print the token. `RUN_STAGING_OWNER_ROUNDTRIP=1` mints a
token at test start. A skipped test is not a green live proof.

### Staging Encrypted Link DM proof (P4)

```bash
npm run proof:staging
```

Two Playwright browser contexts sign up on staging, handshake, and exchange
`chat.message.v0` both ways. Tokens are minted by the staging-invite script
and never printed.

The 2026-08-30 `signupWithSecret` failures ("Pkarr returned no HTTPS
endpoints") were caused by a wrong homeserver key in this harness, not by
Pkarr infrastructure. That key was never a real homeserver. The correct
staging homeserver public key is
`ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy` (pubky-app's
`NEXT_PUBLIC_HOMESERVER` default; it resolves a signed packet on
https://pkarr.pubky.app and https://pkarr.pubky.org). A skipped test is
not a green proof. The `/e2e/dm-harness` page and
`e2e/dm-staging.spec.ts` are the real harness.

Owner roundtrip (2026-08-30, corrected key):
`STAGING_SIGNUP_TOKEN=<token> npm run test:e2e -- e2e/owner-roundtrip.spec.ts`
passed (PUT → public GET → DELETE → 404, 5.5s).

P4 `npm run proof:staging` (2026-08-30, corrected key): two isolated
Chromium processes signed up on staging, reached Encrypted Link
`ready`, and exchanged `hello-from-a` / `hello-from-b`. Passed in 15.7s.
Tokens were minted by the script and not printed.

### Staging private-group proof (P5)

```bash
npm run proof:staging:groups
```

Three isolated Chromium processes sign up on staging. A↔B and A↔C
establish Encrypted Links. A creates a private group with B and C,
sends `chat.group.message.v0`, and both B and C receive it on that
`channel_id`. B replies; A receives it. Tokens are minted by the
staging-invite script and never printed. A skipped test is not a
green live proof.

### Staging payments proof

```bash
npm run proof:staging:payments
```

Two isolated Chromium processes: A signs up and publishes a public
`lno` Payment Endpoint; B reads it unauthenticated via
`getPaymentEndpoint` / `getPaymentList` / `listPaymentMethods`. A and B
then establish an Encrypted Link, A sends a Private Payment List, and B
receives it through `receivePrivateApplicationMessages` and parses with
`parsePrivatePaymentListJson`. A removes the public endpoint; B's
re-fetch is empty. Tokens are minted by the staging-invite script and
never printed. A skipped test is not a green live proof.

P3 exit still needs one live Ring phone run against staging (https
callback). Wasm staging signup from this client is no longer the blocker.

## Static routes and unknown IDs

`output: 'export'` cannot emit HTML for conversation IDs that do not exist at
build time. `/chats` and `/channels` are optional catch-alls
(`app/chats/[[...conversationId]]`, `app/channels/[[...id]]`) with
`generateStaticParams` returning the empty segment so `/chats` and `/channels`
are pre-rendered.

The client page then reads any extra path segment from
`window.location.pathname`. On Vercel, `vercel.json` rewrites
`/chats/:conversationId` → `/chats`, `/channels/:id` → `/channels`, and
`/contacts/:pubky` → `/contacts` so a deep link serves that same static page.
Other hosts need the same rewrite (or users stay on the list route until
in-app navigation exists).

Product routes are wired to StorageService, LinkService, GroupService,
AttachmentService, BackupService, and the payments adapter:

`/`, `/chats`, `/chats/:conversationId`, `/contacts`, `/contacts/:pubky`,
`/requests`, `/channels`, `/channels/:id`, `/enable`, `/profile`, `/settings`,
`/ring-callback`. The PWA (`manifest.webmanifest` + `sw.js`) caches the
offline shell only — no push.

## COOP / COEP and SQLite (P1)

paykit-wasm does **not** need SharedArrayBuffer. This app does **not** set
COOP/COEP on the page — COEP breaks many CDNs. Do not enable the default
sqlite `"opfs"` VFS (that one needs COOP/COEP + SAB).

`getDb()` opens official sqlite3 wasm (`@sqlite.org/sqlite-wasm`) and
chooses a VFS in this order:

1. **`opfs-sahpool`** when OPFS `createSyncAccessHandle` is available.
   Exclusive; only the writer tab installs it.
2. **IDB snapshot** — official sqlite3 memory db, serialized to IndexedDB
   after autocommit writes. This is the `executeSync`-compatible stand-in
   for wa-sqlite `IDBBatchAtomicVFS` (that VFS is async-only; the mobile
   `SqlExecutor` seam is synchronous and we will not add a second SQL API).
3. **kvvfs** (`localStorage`) last. Tiny (~5MB). Used only if IndexedDB is
   missing.

Node / vitest never opens wasm. Tests inject better-sqlite3 via
`setDbExecutor` / `setDbForTests`.

## Web Locks

`src/services/tabLock.ts` exposes `{ mode: 'writer' | 'readonly', requestTakeover() }`.
The first tab takes an exclusive `navigator.locks` lock named
`hypercolor-writer`. Later tabs stay readonly and `TabLockBanner` asks
"Hypercolor is open in another tab — take over?". Takeover uses
`{ steal: true }`; the loser becomes readonly and `getDb()` closes so
sahpool can move.

If `navigator.locks` is missing, this tab is the writer (single-tab
fallback). A second tab in that browser cannot coordinate.

## Wire-contract pin

Copied files under `src/db`, `src/types`, `src/flags`, `src/services`,
`src/utils`, and `src/stores` (the P0 list) must stay byte-identical to
mobile Hypercolor at:

`6185a6a8e6bf3a52831515cb85131a7020704396`

except a 2-line header naming the source path and pin.

`bash scripts/check-wire-drift.sh` diffs that list (header ignored) against
the committed oracle `vendor/hypercolor-wire-pin` (same pin). Override with
`HYPERCOLOR_REPO=/Users/johncarvalho/work/hypercolor` to compare a local
git checkout (`HEAD` at the pin, otherwise `git show <pin>:path`). CI does
not clone `BitcoinErrorLog/hypercolor`.

**Revisit trigger:** if this drift gate fails more than three times in a
quarter, fold the web client into the Hypercolor monorepo instead of copying
files.

Do not copy RN/native modules (`src/db/index.ts`, KeyStore, file I/O, mesh,
Ring auth service, etc.). P1 adds web executors.

## paykit-wasm

Vendored from `BitcoinErrorLog/paykit-rs-official` branch `feat/wasm-binding`
at `24ed3a0e85067d3416e1a7085ed8b7ff9f241267` (Encrypted Links, SB2,
session helpers, and Payment Endpoint / Private Payment List exports).
See `vendor/paykit-wasm/PROVENANCE.md`.

Load only through `src/lib/paykit-wasm.ts` (dynamic import). Never import WASM
at module scope on the server.

```bash
node scripts/paykit-wasm-smoke.mjs
```

## Scripts

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run build            # next build --webpack; writes production out/ (no e2e harness)
npm run preview:static   # serve production out/ with vercel.json rewrites (default :3000)
                         # refuses a tree that contains .e2e-harness
npm run build:e2e:static # NEXT_PUBLIC_E2E_HARNESS=1 rebuild into out-e2e/ (cleans that dir)
npm run test:e2e         # Playwright against next dev (harness env), or PLAYWRIGHT_BASE_URL
npm run test:e2e:static  # build:e2e:static then thread-origin + recovery-gate on out-e2e :3300
```

`npm run test:e2e:static` is the CI-style static proof. It always rebuilds
`out-e2e/` with the harness hook compiled in. Do not run Playwright against a
leftover `out/` — recovery tests need `NEXT_PUBLIC_E2E_HARNESS=1`, and a
harness export is not a production preview. `preview:static` keeps serving
the plain production export.

## Vibeware

`vibeware.yaml` is the authority contract for the three risk-1 UI surfaces
(`hc-chats-ui`, `hc-thread-ui`, `hc-onboarding-ui`). It lists writable paths,
shared forbidden paths, the v1 evidence allowlist and payload schema,
exposure caps, and kill switches. Which keys are enforced vs informational
is tabulated in [docs/vibeware.md](docs/vibeware.md).

The Phase 1 collector lives in `src/services/vibeware/` (forbidden). It
emits only the nine allowlisted events after
`validateEvidencePayload`. Optional ingest:
`NEXT_PUBLIC_VIBEWARE_INGEST_URL` and
`NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN` (empty placeholders in `.env.example`).
With no URL, events go to an in-memory sink (`window.__vibewareSink` when
`NEXT_PUBLIC_E2E_HARNESS=1`).

`scripts/check-vibeware-path-policy` rejects a change set if any file is
outside that surface's `writable_paths` or matches `forbidden_paths`. A path
that matches both is forbidden. On `pull_request`, CI extracts the **base**
tree into `$RUNNER_TEMP/vibeware-base-<run_id>-<run_attempt>` and runs those
copies against the candidate workspace **before** `npm ci`.
`npm run check:vibeware:pr` is local/dev only — it is not the PR gate.
The required status check `CI / check` plus CODEOWNERS on `.github/` is
the out-of-tree control if a candidate deletes that job; that setting is
unverifiable from this tree. Do not use `pull_request_target`.

```bash
./scripts/check-vibeware-path-policy --manifest vibeware.yaml --surface hc-chats-ui --changed-files <file>
./scripts/check-vibeware-path-policy --manifest vibeware.yaml --surface hc-chats-ui --base <sha>
npm run check:vibeware
npm run check:vibeware:pr -- --base <sha> --head <sha> --head-ref <branch>
```

CI (`.github/workflows/ci.yml`) runs the base-tree vibeware PR gates on
`pull_request` before `npm ci`, then typecheck, lint, tests, wasm, and
wire. Push to main runs the in-tree vibeware self-test after `npm ci`.
The wire gate reads `vendor/hypercolor-wire-pin`; it does not check out
the private Hypercolor sibling.

Require review from Code Owners on the CODEOWNERS paths is load-bearing;
this tree cannot prove that GitHub setting.

Deploy later to Vercel (account `john-3778`). Do not treat this README as
permission to ship production.

## Security

See [SECURITY.md](SECURITY.md). Web key custody is weaker than the mobile
app: secrets live in JS/wasm memory, and XSS is the kill shot.
