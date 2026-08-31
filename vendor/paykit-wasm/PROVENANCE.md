# paykit-wasm provenance

Vendored browser WASM binding for the Paykit Encrypted Link messaging
surface and Payment Endpoints. Rebuilt at the recorded official HEAD with
`wasm-pack build --target web --release` (not a copy of a previously
shipped `pkg/`).

## Source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/BitcoinErrorLog/paykit-rs-official` |
| Branch | `feat/sb2-encrypt-export` |
| Commit | `4c0b7a133c5e1535c5d935ff8dc24203e6350003` |
| Base branch | `feat/wasm-binding` @ `24ed3a0e85067d3416e1a7085ed8b7ff9f241267` |
| Upstream | `https://github.com/pubky/paykit-rs` |
| Upstream pin | `c8892f638951f033acbcd12804a31667a81ddc14` (tag anchor v0.1.0-rc43) |
| `pubky-crypto` git dep | `https://github.com/BitcoinErrorLog/pubky-crypto.git` @ `01eb3e6575cf8c707ad0675962581e13aa4da0f0` |
| Package path | `paykit-wasm/pkg` |
| Package name | `paykit-wasm` |
| Package version | `0.1.0-rc45` |
| License | MIT |

This HEAD keeps SB2 / X25519, public storage, session helpers, and Payment
Endpoint + Private Payment List exports from rc44, and **adds** the SB2
encrypt/sign/inbox-kid surface that rc44 only consumed (decrypt/verify):

- `computeInboxKid`
- `sb2Encrypt`
- `sb2Sign`
- `x25519GenerateKeypair` (already present)
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
(`git rev-parse HEAD` = `4c0b7a133c5e1535c5d935ff8dc24203e6350003`). SHA-256
values were computed with `shasum -a 256` against those files on disk after
copy — not copied from an older README.

## Toolchain (recorded at the source build)

Read from `paykit-wasm/pkg/README.md` at the same official HEAD. This `pkg/`
was rebuilt (not reused from an earlier pin):

| Tool | Version |
| --- | --- |
| `wasm-pack` | 0.13.1 (bundled binaryen `wasm-opt`) |
| `rustc` | 1.93.1 (01f6ddf75 2026-02-11) |
| `wasm-bindgen` | 0.2.115 |
| Rust target | `wasm32-unknown-unknown` |
| Node (smoke test) | v22.14.0 |
| Build command | `wasm-pack build --target web --release` (crate invocation: `wasm-pack build paykit-wasm --target web --out-dir pkg --release`) |

## Artifact checksums (SHA-256)

| File | SHA-256 |
| --- | --- |
| `paykit_wasm_bg.wasm` | `5294e9177cc7bcd9c6a489d54c0326678065d644ba427ab1b25c30afda2fdf6b` |
| `paykit_wasm.js` | `6ae0b56feb17a96a897df7637f81f2d97b856bbea34d7376ac7e525a3dc4403f` |
| `paykit_wasm.d.ts` | `23a7fffad0e08b462392e89c7cc9ac2c3be83f95dd1d5cc373e9c1d04504e53f` |
| `paykit_wasm_bg.wasm.d.ts` | `0e5f27cc661a5f425cfe76cfa671062b396ab0b9fbc643fcfb3ab429b45e148a` |
| `package.json` | `8f380ca1cb6ac98e49ead69591d2965d87ee8318e8be0cc4419addd88ba9883a` |

Generated package size: ~1.8 MB (wasm ~1.7 MB). `wasm-opt` output is not
guaranteed bit-identical across platforms; treat these checksums as a record
of this build, and re-record when the pin or toolchain changes.

## Re-vendor

```bash
git clone https://github.com/BitcoinErrorLog/paykit-rs-official.git
cd paykit-rs-official && git checkout 4c0b7a133c5e1535c5d935ff8dc24203e6350003
# This pin's paykit-wasm/pkg was rebuilt with:
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
