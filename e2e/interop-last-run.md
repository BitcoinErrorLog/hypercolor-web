# Web ↔ mobile Encrypted Link DM interop

**When:** 2026-08-30T20:40:58.450Z
**Result:** PASS
**Web worktree:** /Volumes/vibedrive/vibes-dev/hypercolor-web-interop/ (branch interop-proof)
**Web commit:** see `git -C /Volumes/vibedrive/vibes-dev/hypercolor-web-interop/ rev-parse --short HEAD`
**Mobile:** /Users/johncarvalho/work/hypercolor (local Debug sim, deep-link e2e handlers)
**Homeserver:** `ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy`
**Device:** ios 1E4EABB1-F130-497F-A5D8-8C0988EE644A
**Bodies:** `interop-b-to-a-1788122354115` / `interop-a-to-b-1788122354115`

## Steps

- ✅ **device** — iOS simulator 1E4EABB1-F130-497F-A5D8-8C0988EE644A
- ✅ **ios-launch** — reusing live iOS session
- ✅ **apk** — iOS uses preinstalled debug sim app
- ✅ **web-server** — next dev on http://127.0.0.1:3017 (log /var/folders/p9/5rky259j7cl3f1z6t049p2tm0000gn/T/hypercolor-web-interop-3017.log)
- ✅ **mobile-screen** — welcome
- ✅ **clipboard-poller** — HC_E2E ping → pong
- ✅ **clipboard-poller** — HC_E2E ping → pong on Welcome before signup
- ✅ **mint-token-b** — minted mobile signup token
- ✅ **mobile-signup** — debug signup finished
- ✅ **mobile-pubky** — wzsdpf8rt5prh3ypd9uem6wzn9mng81s5nx7uy7us81tqz6oj4po
- ✅ **mint-token-a** — minted web signup token
- ✅ **web-signup** — t1yrxh4p4ratu6nh8yopx8j6hwyt4j8z1b8dsoajeyff7y64xr9y receiver=hypercolor/wallet
- ✅ **web-ensure-loop** — polling ensureLinkWith(wzsdpf8rt5prh3ypd9uem6wzn9mng81s5nx7uy7us81tqz6oj4po)
- ✅ **mobile-send** — clipboard send-dm interop-b-to-a-1788122354115 to t1yrxh4p4ratu6nh8yopx8j6hwyt4j8z1b8dsoajeyff7y64xr9y
- ✅ **web-ensure** — ready
- ✅ **web-receive** — B→A body=interop-b-to-a-1788122354115 kind=chat.message.v0 eventId=20ea0165-152e-4e71-9c0d-4df37524a43a
- ✅ **web-send** — sent interop-a-to-b-1788122354115 to wzsdpf8rt5prh3ypd9uem6wzn9mng81s5nx7uy7us81tqz6oj4po
- ✅ **mobile-receive** — A→B body=interop-a-to-b-1788122354115 kind=chat.message.v0

## Notes

Web A pubky: `t1yrxh4p4ratu6nh8yopx8j6hwyt4j8z1b8dsoajeyff7y64xr9y`
Mobile B pubky: `wzsdpf8rt5prh3ypd9uem6wzn9mng81s5nx7uy7us81tqz6oj4po`
B→A received on web with matching body `interop-b-to-a-1788122354115` kind `chat.message.v0`.
A→B received on mobile with matching body `interop-a-to-b-1788122354115`.
Kind: `chat.message.v0` via LinkService.sendDm / ThreadScreen / e2e send-dm deep link.

Signup tokens and identity secrets were kept in process memory only and are redacted here.
Nothing was pushed. No physical device was used.
Maestro was used for 01-signup only. Post-signup send/sync used the sim pasteboard command channel (`HC_E2E:` / `simctl pbcopy`), with the same sentinel also written to the app Documents file because iOS 18 `Clipboard.getString` cannot read cross-process pasteboard.
