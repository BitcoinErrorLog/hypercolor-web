# paykit-wasm provenance

Vendored browser WASM binding. Copied from the official checkout's already-built
`paykit-wasm/pkg` at `b04e05c` — not rebuilt in this tree.

This bump is **not abort-fix-only**. Relative to Hypercolor's previous product
pin `24ed3a0e85067d3416e1a7085ed8b7ff9f241267` (`0.1.0-rc44`), `b04e05c` is a
fast-forward of eight commits:

1. `4c0b7a1` feat: export sb2Encrypt and sb2Sign from wasm
2. `51f1e68` Export migrateHomeserverWithSecret on paykit-wasm
3. `a4c66d9` Restore pkarr CAS baseline before republish retry
4. `2ff7d44` Retry WASM homeserver publish after CAS and transport errors
5. `6a58d26` fix: retry pkarr publish on unexpected relay responses
6. `3867a08` feat: expose resolveMostRecentHomeserver on wasm client
7. `a2999bf` chore: rebuild paykit-wasm pkg
8. `b04e05c` fix: drain wasm write bodies so fetch is not aborted

## Source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/BitcoinErrorLog/paykit-rs-official` |
| Branch | `fix/wasm-homeserver-write-abort` |
| Commit | `b04e05cde937110bbd9fbedfa5ce36175b8cadc0` |
| Upstream | `https://github.com/pubky/paykit-rs` |
| Upstream pin | `c8892f638951f033acbcd12804a31667a81ddc14` (tag anchor v0.1.0-rc43) |
| `pubky-crypto` git dep | `https://github.com/BitcoinErrorLog/pubky-crypto.git` @ `01eb3e6575cf8c707ad0675962581e13aa4da0f0` |
| Package path | `paykit-wasm/pkg` |
| Package name | `paykit-wasm` |
| Package version | `0.1.0-rc47` |
| License | MIT |

The artifacts below are byte-identical to `paykit-wasm/pkg` on that checkout
(pkg timestamps 2026-09-01 00:48). SHA-256 values were computed with
`shasum -a 256` against those files on disk after the copy.

## Toolchain (recorded at the source build)

| Tool | Version |
| --- | --- |
| `wasm-pack` | 0.13.1 (bundled binaryen `wasm-opt`) |
| `rustc` | 1.93.1 (01f6ddf75 2026-02-11) |
| `wasm-bindgen` | 0.2.115 |
| Rust target | `wasm32-unknown-unknown` |
| Node (smoke test) | v22.14.0 |
| Build command | `wasm-pack build paykit-wasm --target web --out-dir pkg --release` |
| Source smoke | `node paykit-wasm/scripts/smoke.mjs` (17/17, WASM_EXIT=0) |

## Artifact checksums (SHA-256)

| File | SHA-256 |
| --- | --- |
| `paykit_wasm_bg.wasm` | `5e7c020d1d46ea7e9e851840c181710f867d90df78d15ba089d29092ad9a4968` |
| `paykit_wasm.js` | `7b3ff8c3eed62d2dc15db0f51fcc15a1d72a029483b673e89ce8aaa2dad86c37` |
| `paykit_wasm.d.ts` | `5974284a8b5573fa5e0088e7809fa6f19b67bed12f5266ec6ea285852b5a3e5a` |
| `paykit_wasm_bg.wasm.d.ts` | `903344c9b0187f35f1629f35089afaa03ac7f504842ca56b569a30c87c77cf57` |
| `package.json` | `65e7d4a03984a38686323ac32cd2cf886a73538ae7a1c74f6f1f47cd6e27e7bf` |
