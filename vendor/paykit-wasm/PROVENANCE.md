# paykit-wasm provenance

Vendored browser WASM binding for the Paykit Encrypted Link messaging
surface and Payment Endpoints. Copied from the official checkout's
`paykit-wasm/pkg` at the recorded HEAD — not rebuilt, and not the older
mp-dm pin `7bbaba0447724776a1f52f8f581bcbcaf6dd67d2`.

## Source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/BitcoinErrorLog/paykit-rs-official` |
| Branch | `feat/wasm-binding` |
| Commit | `24ed3a0e85067d3416e1a7085ed8b7ff9f241267` |
| Upstream | `https://github.com/pubky/paykit-rs` |
| Upstream pin | `c8892f638951f033acbcd12804a31667a81ddc14` (tag anchor v0.1.0-rc43) |
| `pubky-crypto` git dep | `https://github.com/BitcoinErrorLog/pubky-crypto.git` @ `01eb3e6575cf8c707ad0675962581e13aa4da0f0` |
| Package path | `paykit-wasm/pkg` |
| Package name | `paykit-wasm` |
| Package version | `0.1.0-rc44` |
| License | MIT |

This HEAD keeps SB2 / X25519, public storage, and session helpers, and
adds Payment Endpoint + Private Payment List exports:

- `x25519GenerateKeypair`
- `sb2VerifySignature`
- `sb2Decrypt`
- `putPublic`
- `deletePublic`
- `publicGet`
- `signOutSession`
- `resumeSessionFromCookie`
- `setPaymentEndpoint`
- `removePaymentEndpoint`
- `getPaymentEndpoint`
- `getPaymentList`
- `listPaymentMethods`
- `listPaykitReceiverPaths`
- `serializePrivatePaymentListJson`
- `parsePrivatePaymentListJson`
- `EncryptedLinkHandle.sendPrivatePaymentList`

The five artifacts below are byte-identical to `paykit-wasm/pkg` at that commit
(`git rev-parse HEAD` = `24ed3a0e85067d3416e1a7085ed8b7ff9f241267`). SHA-256
values were computed with `shasum -a 256` against those files on disk — not
copied from an older README.

## Toolchain (recorded at the source build)

Read from `paykit-wasm/pkg/README.md` at the same official HEAD:

| Tool | Version |
| --- | --- |
| `wasm-pack` | 0.13.1 (bundled binaryen `wasm-opt`) |
| `rustc` | 1.93.1 (01f6ddf75 2026-02-11) |
| `wasm-bindgen` | 0.2.115 |
| Rust target | `wasm32-unknown-unknown` |
| Node (smoke test) | v22.14.0 |
| Build command | `wasm-pack build paykit-wasm --target web --out-dir pkg --release` |

## Artifact checksums (SHA-256)

| File | SHA-256 |
| --- | --- |
| `paykit_wasm_bg.wasm` | `a33b944c81b1661047b4d6f50ee41aab9342eef664a4e4f1470fcd94790949b5` |
| `paykit_wasm.js` | `9e0520f8f357d9c186828c9fefa4cceb52aa28389a05312fe359d7219a417507` |
| `paykit_wasm.d.ts` | `6196e530c54dd210d39235ad424c42ae26a9e6aa2bae120ee1a1366253c13c21` |
| `paykit_wasm_bg.wasm.d.ts` | `4489b880773d5fbab7cf1aec9ac77c7d39b4def6a235af45cf054340c0afe055` |
| `package.json` | `ecfde395fb97cdeec3cc22768601c483059a7e5b02a842eab260c83e2ef0c60f` |

Generated package size: ~1.8 MB (wasm ~1.7 MB). `wasm-opt` output is not
guaranteed bit-identical across platforms; treat these checksums as a record
of this build, and re-record when the pin or toolchain changes.

## Re-vendor

```bash
git clone https://github.com/BitcoinErrorLog/paykit-rs-official.git
cd paykit-rs-official && git checkout 24ed3a0e85067d3416e1a7085ed8b7ff9f241267
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
