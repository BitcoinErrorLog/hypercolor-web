# Vibeware contract

`vibeware.yaml` is the authority file for the three risk-1 UI surfaces
(`hc-chats-ui`, `hc-thread-ui`, `hc-onboarding-ui`). CI evaluates candidate
PRs against the **base** copy of this file. A candidate cannot rewrite the
evaluator and then grade itself.

Actor on every evidence event is a **cohort key** (`experimental` |
`internal` | `opted_in`). A `pubky` field is never allowed.

## Candidate PRs

A PR is a candidate when the head branch matches `vibeware/**` or
`candidate/**`, or when HEAD contains `.vibeware/candidate` with
`surface: <id>`. A `vibeware/**` / `candidate/**` branch that omits the
marker fails. Human PRs are not writable-path denied.

```text
surface: hc-chats-ui
```

`.vibeware/candidate` is excluded from the changed-file list so adding the
required marker is not `outside_writable`.

## Enforced vs informational keys

| Key | Enforced? |
|---|---|
| `evidence_allowlist` | Yes — must deep-equal the frozen v1 list |
| `evidence_payloads` | Yes — exact per-event field lists |
| `max_payload_bytes` | Yes — must be `256` |
| `privacy.contains_user_content` | Yes — must be `false` |
| `forbidden_paths` | Yes — min length + required entries (`session.ts`, `vibeware.yaml`, `.github/**`, `scripts/check-vibeware*`) |
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

### Message body and draft display (F4)

`src/components/message-bubble.tsx` and `src/components/composer.tsx` may
continue to receive `message.body` / draft text for **display only**.

Reason: the product must render messages; file-level policy cannot hide
plaintext from the UI process.

Mitigation: writable-import ban, payload schema (no `body` / `pubky` /
`recovery` keys), and the P1 collector fail-closed on
`validateEvidencePayload`.

### Type imports (F4 import check)

Writable files may import `src/types/**` for prop typing and kind
constants.

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
