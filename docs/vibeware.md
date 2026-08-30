# Vibeware contract

`vibeware.yaml` is the authority file for the three risk-1 UI surfaces
(`hc-chats-ui`, `hc-thread-ui`, `hc-onboarding-ui`). On `pull_request`, CI
checks out the candidate, fetches the PR shas, and sets up Node **without**
`npm ci`. It then extracts the **base** tree into
`$RUNNER_TEMP/vibeware-base-<run_id>-<run_attempt>` (outside the candidate
workspace, not a predictable `vibeware-base` name) and **immediately**
invokes those copies:

- `node $BASE/scripts/check-vibeware-pr.mjs --repo $GITHUB_WORKSPACE …`
- `node $BASE/scripts/check-vibeware-selftest.mjs`
- `node $BASE/scripts/check-vibeware-writable-imports.mjs --repo $GITHUB_WORKSPACE`

Only after those gates do wire-pin checkout, `npm ci`, typecheck, lint,
tests, wasm, and wire run. Candidate `postinstall` therefore cannot
overwrite the extracted evaluator before it grades the diff.

CI does **not** treat `npm run check:vibeware:pr` from the candidate
`package.json` as the PR gate. Push-to-main keeps in-tree
`npm run check:vibeware` after `npm ci`. Local/dev npm scripts remain.
A candidate cannot rewrite the evaluator and then grade itself.

Actor on every evidence event is a **cohort key** (`experimental` |
`internal` | `opted_in`). A `pubky` field is never allowed.

## Phase 1 collector

`src/services/vibeware/**` is shared-forbidden. `emit` calls
`validateEvidencePayload` from `scripts/vibeware-evidence.mjs` (re-exported
by `src/services/vibeware/schema.ts` so the browser cannot keep a weaker
copy) and drops unknown types, extra keys, banned field names, nested
values, non-string values, and values outside `EVIDENCE_FIELD_VALUES`.
Writable surfaces must not import this directory; they pass a callback or
dispatch `hypercolor-vibeware` with an already-shaped payload.

Ingest is `NEXT_PUBLIC_VIBEWARE_INGEST_URL` (optional Bearer
`NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN`). The collector omits `Authorization`
unless that token is non-empty. If the URL is unset, events stay in a
256-event ring buffer. `window.__vibewareSink` is attached only when
`NEXT_PUBLIC_E2E_HARNESS=1`. Payloads are never logged and never sent to
Sentry.

### Ingest token posture (static export)

This app is `output: "export"`. Next.js inlines every `NEXT_PUBLIC_*`
value into the shipped client bundle, so a static export cannot hide
`NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN`. The token is a **public write-only**
credential: anyone who downloads the site can read it and POST to the
ingest URL.

The ingest store MUST re-validate every event with the P0
`validateEvidencePayload` in `scripts/vibeware-evidence.mjs` (already true
on the store). Client-side validation is not a trust boundary. Rate-limit
and fail closed on the store. Do not put a real secret in `.env` or the
build. A same-origin proxy that could hold a private token is out of
scope for static export.

## Candidate PRs

A PR is a candidate when the head branch matches `vibeware/**` or
`candidate/**`, or when HEAD contains `.vibeware/candidate` with
`surface: <id>`. A `vibeware/**` / `candidate/**` branch that omits the
marker fails.

```text
surface: hc-chats-ui
```

`.vibeware/candidate` is excluded from the changed-file list so adding the
required marker is not `outside_writable`.

## Orchestrator vs human PRs (trust assumption)

The loop orchestrator MUST only open agent PRs on `vibeware/**` or
`candidate/**` branches that include `.vibeware/candidate`. Human PRs skip
writable-path denial by design. That skip is a trust assumption: the tree
cannot stop a human from editing `session.ts` on `feat/foo`. The gate only
denies writable-path violations on marked candidate branches.

## Code owners (load-bearing, unverifiable here)

`.github/CODEOWNERS` lists `vibeware.yaml`, `scripts/check-vibeware*`,
`scripts/vibeware-evidence.mjs`, `scripts/copy-sqlite-wasm.mjs`, `.github/`,
`package.json`, `package-lock.json`, `docs/vibeware.md`, and `README.md`.
Requiring review from Code Owners on those paths is load-bearing. This
tree cannot prove the GitHub branch-protection setting is enabled.

## Enforced vs informational keys

| Key | Enforced? |
|---|---|
| `evidence_allowlist` | Yes — must deep-equal the frozen v1 list |
| `evidence_payloads` | Yes — exact per-event field lists |
| `max_payload_bytes` | Yes — must be `256` |
| `privacy.contains_user_content` | Yes — must be `false` |
| `forbidden_paths` | Yes — min length + required entries (`session.ts`, `vibeware.yaml`, `.github/**`, `scripts/check-vibeware*`, `scripts/copy-sqlite-wasm.mjs`, `package.json`, `package-lock.json`, `useInbox.ts`, `useChannel.ts`, `useSignOut.ts`, `src/services/vibeware/**`) |
| `scope.writable_paths` | Yes — non-empty; candidate diffs must stay inside |
| `evidence.allowed` | Yes — subset of the allowlist |
| `kill_switch.flag` | Yes — non-empty string |
| `exposure.allowed_cohorts` | Yes — subset of `{experimental, internal, opted_in}` |
| `exposure.max_initial_percent` | Yes — `1..10` |
| `exposure.requires_human_for_percent_over` | Yes — `>= 25` |
| `autonomy.auto_merge` | Yes — must be `false` |
| `autonomy.auto_promote` | Yes — must be `false` |
| `evidence.forbidden` | Informational name list; payload validator + denylist are the authority |
| `selection.*` | Informational |
| `autonomy.max_level` | Informational |
| `surface.owner` / `risk` / `repositories` | Informational |
| YAML comments | Informational |

## Waivers

### Workflow-from-PR (F17)

GitHub runs the workflow file from the merge commit. In-tree policy
cannot stop a candidate from deleting the extract/gate job. Binding
control is the required status check named exactly `CI / check` plus
CODEOWNERS on `.github/`. If the candidate deletes the gate, that
required check never reports and merge is blocked **once that GitHub
setting exists**. This is load-bearing and unverifiable from the tree.
Do not use `pull_request_target`.

### Message body and draft display (F4)

`src/components/message-bubble.tsx` and `src/components/composer.tsx` may
continue to receive `message.body` / draft text for **display only**.

Reason: the product must render messages; file-level policy cannot hide
plaintext from the UI process.

Mitigation: writable-import ban, payload schema (no `body` / `pubky` /
`recovery` keys), and the P1 collector fail-closed on
`validateEvidencePayload`.

### Inbox preview display (F11)

`src/components/chats-page.tsx` may render host-supplied preview strings
for **display only**. Inbox subscription, preview mapping, and
`startChat` / `addManualContact` live in forbidden
`src/services/chats/chatsPageHost.tsx`.

Reason: the inbox list must show a last-message snippet. The writable
file does not subscribe to inbox state or write contacts.

Mitigation: same as F4. Conversation ids are not evidence fields; the
collector must not emit them.

### Type imports (F4 import check)

Writable files may import `src/types/**` for prop typing and kind
constants. `src/components/thread-view.tsx` may import the
`SessionUiStatus` type from `src/stores/sessionStatusStore.ts`. Shared
`forbidden_paths` therefore lists `src/stores/inboxStore.ts` rather than
`src/stores/**`.

Reason: those modules are compile-time shapes and constants. They do not
perform IO, session, or send.

Mitigation: the import check still bans every other forbidden path,
`src/services/vibeware/**`, and `fetch` / `sendBeacon` / `XMLHttpRequest` /
`WebSocket`.

### Auth QR chrome (F4)

`src/components/auth-url-panel.tsx` and `src/components/auth-qr.tsx` may
receive the authorization URL string to render the QR.

Reason: Ring onboarding needs a scannable grant. Clipboard, `href`, and
the raw URL paragraph live in forbidden `src/components/auth-url-actions.tsx`.

## Path safety

`normalizePath` rejects `..` / `.` segments, a leading `/`, and backslash
leftovers. Those diffs fail closed (`unsafe_path`) even if a writable glob
would match.

`git diff --name-status` typechange (`T`) and mode `120000` (symlink) are
rejected. Documented in `scripts/check-vibeware-path-policy.mjs`.
