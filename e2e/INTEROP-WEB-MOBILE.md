# Web ↔ mobile Encrypted Link DM interop

Live proof: two fresh staging identities, `chat.message.v0` over Encrypted Links, both directions.

| Side | Checkout | How it is driven |
| --- | --- | --- |
| Web A | this worktree (`interop-proof`, from `origin/main` / c24c9d4+) | `/e2e/dm-harness` → `window.runDmSignup` / `runDmEnsure` / `runDmSend` / `runDmSync` |
| Mobile B | `/Users/johncarvalho/work/hypercolor` | iOS simulator Debug app (`org.name.hypercolor`). Maestro `01-signup.yaml` only. Post-signup send/sync via `simctl openurl` (`hypercolor://e2e/send-dm`, `hypercolor://e2e/sync-inbox`). Do not use Main-tab Maestro taps. |

Neither side needed a committed mobile change. Mobile already accepts an arbitrary peer via `LinkService.ensureLinkWith` / `ContactsService.addManualContact` + `sendDm`. Web's harness does the same.

## Command (local only)

Do **not** `git push` or `gh pr create`. Tokens stay in env/memory.

```bash
export PATH="$HOME/.maestro/bin:$PATH"
# iOS simulator B80C2104-E1C5-4CF4-A16E-8B17975E66D0 must be booted
# with the c7157aa debug build (Debug signup visible).

cd /Volumes/vibedrive/vibes-dev/hypercolor-web-interop
npm install   # once
npm run proof:interop
```

Android (`INTEROP_PLATFORM=android`) only works with a **debug** APK (`__DEV__` so `DebugSignupPanel` mounts). The file at `dist/hypercolor-debug.apk` is not that.

The script:

1. Uses the preinstalled iOS sim app (`org.name.hypercolor`). No mobile source changes.
2. Mints two staging signup tokens via `$STAGING_INVITE_SCRIPT` (default `~/.cursor/skills/pubky-staging-invite/scripts/generate.sh`). Tokens are never printed or written.
3. Starts `next dev` on `127.0.0.1:3017` unless `PLAYWRIGHT_BASE_URL` is set.
4. Maestro `e2e/maestro/01-signup.yaml` — mobile B debug signup + Enable Messaging (already provisioned).
5. Playwright — web A `runDmSignup`, then a `runDmEnsure(B)` poll loop.
6. Maestro `02-add-contact-send.yaml` — mobile pastes A's pubky, opens the thread, sends `interop-b-to-a-<ts>` (`sendDm` → `ensureLinkWith`).
7. Web waits until the link is `ready`, `runDmSync([B])` must contain that body.
8. Web `runDmSend(B, interop-a-to-b-<ts>)`.
9. Maestro `03-assert-inbound.yaml` — Chats focus syncs the inbox; ThreadScreen must show the A→B body.

Homeserver: `ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy`.

## Last run

See `e2e/interop-last-run.md` (tokens redacted). Re-running overwrites it.

## Cleanup

```bash
# leave this worktree in place
adb -s emulator-5556 emu kill   # if the Android AVD was running
# iOS sim is left as found unless you also want it shut down
```
