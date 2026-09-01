# paykit-wasm provenance

Vendored browser WASM binding. Copied from the official checkout's already-built
`paykit-wasm/pkg` at `f978731` — not rebuilt in this tree.

This bump is **rc49** on top of the rc48 pin. Relative to Hypercolor's
previous product pin `24ed3a0e85067d3416e1a7085ed8b7ff9f241267`
(`0.1.0-rc44`), `f978731` is a fast-forward of ten commits:

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

`f978731` races the write-body drain against a 5s timeout and returns
`RequestError::Timeout` so a stalled 2xx body cannot hang the PUT.

## Source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/BitcoinErrorLog/paykit-rs-official` |
| Branch | `fix/wasm-homeserver-write-abort` |
| Commit | `f97873183491f671220ae8e72f407df0a10ef69a` |
| Upstream | `https://github.com/pubky/paykit-rs` |
| Upstream pin | `c8892f638951f033acbcd12804a31667a81ddc14` (tag anchor v0.1.0-rc43) |
| `pubky-crypto` git dep | `https://github.com/BitcoinErrorLog/pubky-crypto.git` @ `01eb3e6575cf8c707ad0675962581e13aa4da0f0` |
| Package path | `paykit-wasm/pkg` |
| Package name | `paykit-wasm` |
| Package version | `0.1.0-rc49` |
| License | MIT |
| Previous pin | `cae1a8fb8bf9b05ca5e25a935e873db59da63f2a` (`0.1.0-rc48`) |

The artifacts below are byte-identical to `paykit-wasm/pkg` on that checkout.
SHA-256 values were computed with `shasum -a 256` against those files on
disk after the copy.

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
| `paykit_wasm_bg.wasm` | `7f725d51e7617b57d55d65921c96f722804da26285cfc52d1cf858e4bf029354` |
| `paykit_wasm.js` | `6d7a0570ecb1b3291da6ff42f709f84a625a1cca3ff62cd3b64f8a8aae076d92` |
| `paykit_wasm.d.ts` | `65f3d7b3676692cede5fd777af3d9d87afb4d3508cc3fe34dd8f9f22bbee327c` |
| `paykit_wasm_bg.wasm.d.ts` | `5d4ff6da1c60e4379e7adbbdc94767823f7a368157707eb8ed0e32ec1283e00d` |
| `package.json` | `39fdb1a9c421fc04dddffc6ce2b77b750d28e1d12731f53e2082245e8af3ffaa` |
