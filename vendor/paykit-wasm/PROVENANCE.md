# paykit-wasm provenance

Vendored browser WASM binding for the Paykit Encrypted Link messaging
surface and Payment Endpoints. Copied from the official checkout's already-built
`paykit-wasm/pkg` — not rebuilt in this tree.

This bump is **rc50** (`d4a73a5`) on top of the rc49 pin. Relative to the
previous product pin `24ed3a0e85067d3416e1a7085ed8b7ff9f241267`
(`0.1.0-rc44` on `feat/wasm-binding`), the public
`fix/wasm-homeserver-write-abort` branch is eleven commits:

1. `4c0b7a1` feat: export sb2Encrypt and sb2Sign from wasm
2. `51f1e68` Export migrateHomeserverWithSecret on paykit-wasm
3. `a4c66d9` Restore pkarr CAS baseline before republish retry
4. `2ff7d44` Retry WASM homeserver publish after CAS and transport errors
5. `6a58d26` fix: retry pkarr publish on unexpected relay responses
6. `3867a08` feat: expose resolveMostRecentHomeserver on wasm client
7. `a2999bf` chore: rebuild paykit-wasm pkg
8. `b04e05c` fix: drain wasm write bodies so fetch is not aborted
9. `cae1a8f` fix: drop leftover pkarr stream after BrowserHttp
10. `f978731` fix: bound wasm write-body drain so a stalled 2xx cannot hang
11. `d4a73a5` fix: bound error-body drain and bump wasm to rc50

`d4a73a5` applies the same `race_write_body_drain` bound to
`check_http_status`'s error-body `text()` read (a hostile homeserver
can hang the error path the same way F2 hung the 2xx path) and clears
the wasm `setTimeout` on drop of `wasm_sleep`. Native unit tests cover
a never-completing error body → typed timeout + canonical-reason
fallback.

## Source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/BitcoinErrorLog/paykit-rs-official` |
| Branch | `fix/wasm-homeserver-write-abort` |
| Commit | `d4a73a5765e1f0b18ed451d78f98dab97c611a8c` |
| Upstream | `https://github.com/pubky/paykit-rs` |
| Upstream pin | `c8892f638951f033acbcd12804a31667a81ddc14` (tag anchor v0.1.0-rc43) |
| `pubky-crypto` git dep | `https://github.com/BitcoinErrorLog/pubky-crypto.git` @ `01eb3e6575cf8c707ad0675962581e13aa4da0f0` |
| Package path | `paykit-wasm/pkg` |
| Package name | `paykit-wasm` |
| Package version | `0.1.0-rc50` |
| License | MIT |
| Previous pin | `f97873183491f671220ae8e72f407df0a10ef69a` (`0.1.0-rc49`) |

The five artifacts below are byte-identical to `paykit-wasm/pkg` on that
checkout (`git rev-parse HEAD` = `d4a73a5765e1f0b18ed451d78f98dab97c611a8c`).
SHA-256 values were computed with `shasum -a 256` against those files on
disk after the copy — not invented and not copied from an older README.

## Toolchain (recorded at the source build)

Re-recorded on this machine with `rustc --version --verbose` and
`cargo --version --verbose` (2026-09-01):

| Tool | Version |
| --- | --- |
| `wasm-pack` | 0.13.1 (bundled binaryen `wasm-opt`) |
| `rustc` | 1.93.1 (01f6ddf75 2026-02-11) host `aarch64-apple-darwin` LLVM 21.1.8 |
| `wasm-bindgen` | 0.2.115 |
| Rust target | `wasm32-unknown-unknown` |
| Node (smoke test) | v22.14.0 |
| Build command | `wasm-pack build paykit-wasm --target web --out-dir pkg --release` |
| Source smoke | `node paykit-wasm/scripts/smoke.mjs` (17/17, WASM_EXIT=0) |
| `cargo` | 1.93.1 (083ac5135 2025-12-15) host `aarch64-apple-darwin` libgit2 1.9.1 |

## Artifact checksums (SHA-256)

| File | SHA-256 |
| --- | --- |
| `paykit_wasm_bg.wasm` | `fe41d70bfb4a23ec7e21713998cf960318a84ab3845775f62211a0f0bfb3024d` |
| `paykit_wasm.js` | `df0e5f7804ee62bd4b880c2f532635afe9e47c5cd06c766c95df4eec47db6392` |
| `paykit_wasm.d.ts` | `bf0696f9d72fc02310a6a1815a99b41b1be768020f3a41199cc337ce54dc2398` |
| `paykit_wasm_bg.wasm.d.ts` | `cebe23ebf38336009e38e3e7627d7df503b54fba24e18ae1abb33834c93941c0` |
| `package.json` | `043f33bb2b4fdb2602b609e5138b68b506937953d0c1775ccc624eb27238764f` |

Generated package size: ~1.8 MB (wasm ~1.8 MB). `wasm-opt` output is not
guaranteed bit-identical across platforms; treat these checksums as a record
of this build, and re-record when the pin or toolchain changes.

## Independent rebuild verification

Performed for `d4a73a5` on 2026-09-01, same machine as the source build:

- Checkout at `d4a73a5` with a clean working tree (`git status --porcelain`
  empty). The commit is the local HEAD of
  `fix/wasm-homeserver-write-abort` (`git rev-parse HEAD` =
  `d4a73a5765e1f0b18ed451d78f98dab97c611a8c`). A `git worktree add`
  of that pin required `GIT_LFS_SKIP_SMUDGE=1` because the android
  `.so` LFS object is not on the server; wasm sources do not need it.
- Same-tree forced recompile: after `touch`ing `vendor/pubky/src/util.rs`
  and `paykit-wasm/src/lib.rs`, `wasm-pack` rebuilt `pubky`,
  `paykit-lib`, and `paykit-wasm`, and `wasm-opt` produced the same
  `paykit_wasm_bg.wasm` SHA-256 recorded above (`fe41d70bf…`).
  JS / `.d.ts` / `package.json` also matched.
- Clean worktree at `/tmp/paykit-rc50-verify` with a separate
  `CARGO_TARGET_DIR`: JS, both `.d.ts` files, and `package.json` were
  byte-identical to the pin. `paykit_wasm_bg.wasm` was **not**
  bit-identical (`3c828dd1fd0ec14ff25e80ada42d1db0417608e681a8efee420d8b7d4de8a36f`).
  That is the documented `wasm-opt` non-determinism across compile
  contexts (different target dir / cold LLVM), not a source drift.
  `node paykit-wasm/scripts/smoke.mjs` on the clean rebuild: 17/17.
- `node paykit-wasm/scripts/smoke.mjs` on the source `pkg`: 17/17.
- `npm run check:wasm` against the vendored copy in this repo: passed.

The vendored `.wasm` is the same-tree artifact whose hash is recorded
above. The pin is trusted on that match plus the clean-checkout JS
identity and both smokes — not on a claim that `wasm-opt` is stable
across target directories.

## Re-vendor

```bash
git clone https://github.com/BitcoinErrorLog/paykit-rs-official.git
cd paykit-rs-official && git checkout d4a73a5765e1f0b18ed451d78f98dab97c611a8c
# Prefer the already-built paykit-wasm/pkg at that HEAD.
# Rebuild only if those artifacts are missing or their shasum -a 256
# values do not match the files on disk:
#   rustup target add wasm32-unknown-unknown
#   wasm-pack build paykit-wasm --target web --out-dir pkg --release
# copy package.json, paykit_wasm.js, paykit_wasm.d.ts,
# paykit_wasm_bg.wasm, paykit_wasm_bg.wasm.d.ts into vendor/paykit-wasm/
shasum -a 256 vendor/paykit-wasm/{package.json,paykit_wasm.js,paykit_wasm.d.ts,paykit_wasm_bg.wasm,paykit_wasm_bg.wasm.d.ts}
npm install
node scripts/paykit-wasm-smoke.mjs
```

Then update the commit pin, toolchain table, and checksums in this file.

The app references the package as `"paykit-wasm": "file:vendor/paykit-wasm"`.
Load it only through `src/lib/paykit-wasm.ts` (dynamic import). Never import
the WASM module at module scope on the server.

This page does **not** set COOP/COEP. The binding does not need SharedArrayBuffer.
P1 will use `opfs-sahpool` + Web Locks, not the default sqlite OPFS VFS.
