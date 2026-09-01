# paykit-wasm provenance

Vendored browser WASM binding for the Paykit Encrypted Link messaging
surface and Payment Endpoints. Copied from the official checkout's already-built
`paykit-wasm/pkg` — not rebuilt in this tree.

This bump is **not abort-fix-only**. Relative to the previous pin
`24ed3a0e85067d3416e1a7085ed8b7ff9f241267` (`0.1.0-rc44` on
`feat/wasm-binding`), `b04e05c` is a fast-forward of eight commits:

1. `4c0b7a1` feat: export sb2Encrypt and sb2Sign from wasm
2. `51f1e68` Export migrateHomeserverWithSecret on paykit-wasm
3. `a4c66d9` Restore pkarr CAS baseline before republish retry
4. `2ff7d44` Retry WASM homeserver publish after CAS and transport errors
5. `6a58d26` fix: retry pkarr publish on unexpected relay responses
6. `3867a08` feat: expose resolveMostRecentHomeserver on wasm client
7. `a2999bf` chore: rebuild paykit-wasm pkg
8. `b04e05c` fix: drain wasm write bodies so fetch is not aborted

The last commit is the homeserver write-abort drain. The rest is already on
the public `fix/wasm-homeserver-write-abort` branch (sb2 exports, pkarr/CAS
retries, homeserver helpers). App callers already `await putPublic` /
`deletePublic` without using return values — `Result<()>` stays compatible.

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
| Previous pin | `24ed3a0e85067d3416e1a7085ed8b7ff9f241267` (`0.1.0-rc44`) |

The five artifacts below are byte-identical to `paykit-wasm/pkg` on that
checkout (`git rev-parse HEAD` = `b04e05cde937110bbd9fbedfa5ce36175b8cadc0`,
pkg timestamps 2026-09-01 00:48). SHA-256 values were computed with
`shasum -a 256` against those files on disk after the copy — not invented
and not copied from an older README.

## Toolchain (recorded at the source build)

Read from `paykit-wasm/pkg/README.md` at the same official HEAD, and
confirmed on the build machine (`rustc --version`, `wasm-pack --version`,
`node --version`, `Cargo.lock` `wasm-bindgen`):

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

Generated package size: ~1.8 MB (wasm ~1.7 MB). `wasm-opt` output is not
guaranteed bit-identical across platforms; treat these checksums as a record
of this build, and re-record when the pin or toolchain changes.

## Re-vendor

```bash
git clone https://github.com/BitcoinErrorLog/paykit-rs-official.git
cd paykit-rs-official && git checkout b04e05cde937110bbd9fbedfa5ce36175b8cadc0
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
