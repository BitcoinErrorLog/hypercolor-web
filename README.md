# Hypercolor (web)

Static web client for **Hypercolor Encrypted Links**. Same protocol as the
mobile app at [`BitcoinErrorLog/hypercolor`](https://github.com/BitcoinErrorLog/hypercolor)
commit `c7157aaa1b338dd1d8545e82f639007cba945631`. BLE mesh is omitted.

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
`/chats/:conversationId` → `/chats` and `/channels/:id` → `/channels` so a
deep link serves that same static page. Other hosts need the same rewrite (or
users stay on `/chats` until in-app navigation exists).

Product routes shipped as titled pages (not fake inbox data):

`/`, `/chats`, `/contacts`, `/requests`, `/channels`, `/enable`, `/profile`,
`/settings`, `/ring-callback`.

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

`c7157aaa1b338dd1d8545e82f639007cba945631`

except a 2-line header naming the source path and pin.

`bash scripts/check-wire-drift.sh` diffs that list (header ignored) against
the local checkout `/Users/johncarvalho/work/hypercolor` when its `HEAD`
matches the pin, otherwise `git show <pin>:path`, otherwise a clone of
`https://github.com/BitcoinErrorLog/hypercolor.git`.

**Revisit trigger:** if this drift gate fails more than three times in a
quarter, fold the web client into the Hypercolor monorepo instead of copying
files.

Do not copy RN/native modules (`src/db/index.ts`, KeyStore, file I/O, mesh,
Ring auth service, etc.). P1 adds web executors.

## paykit-wasm

Vendored from `BitcoinErrorLog/paykit-rs-official` branch `feat/wasm-binding`
at `132628c1622de4a76c1c52e0033aae225d087732` (includes
`resumeSessionFromCookie`). See `vendor/paykit-wasm/PROVENANCE.md`.

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
npm run build          # next build --webpack; writes out/
npm run preview        # serve out/ on :3000
npm run test:e2e       # Playwright; point PLAYWRIGHT_BASE_URL at dev or out/
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, vitest, the wasm smoke,
and the wire-drift check. Checking out the private Hypercolor pin in Actions
needs a token that can read `BitcoinErrorLog/hypercolor` (`HYPERCOLOR_READ_TOKEN`
if the default `GITHUB_TOKEN` cannot).

Deploy later to Vercel (account `john-3778`). Do not treat this README as
permission to ship production.

## Security

See [SECURITY.md](SECURITY.md). Web key custody is weaker than the mobile
app: secrets live in JS/wasm memory, and XSS is the kill shot.
