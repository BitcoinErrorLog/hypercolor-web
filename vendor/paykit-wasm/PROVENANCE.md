# paykit-wasm provenance

Vendored browser WASM binding for the Paykit Encrypted Link messaging surface.
Copied from the official checkout's `paykit-wasm/pkg` at the recorded HEAD —
not rebuilt, and not the older mp-dm pin `7bbaba0447724776a1f52f8f581bcbcaf6dd67d2`.

## Source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/BitcoinErrorLog/paykit-rs-official` |
| Branch | `feat/wasm-binding` |
| Commit | `f753cb23d4e97b219d6fb83f7a0d60b67500c9bc` |
| Upstream | `https://github.com/pubky/paykit-rs` |
| Upstream pin | `c8892f638951f033acbcd12804a31667a81ddc14` (tag anchor v0.1.0-rc43) |
| `pubky-crypto` git dep | `https://github.com/BitcoinErrorLog/pubky-crypto.git` @ `01eb3e6575cf8c707ad0675962581e13aa4da0f0` |
| Package path | `paykit-wasm/pkg` |
| Package name | `paykit-wasm` |
| Package version | `0.1.0-rc44` |
| License | MIT |

This HEAD adds SB2 / X25519, public storage, and session helpers:

- `x25519GenerateKeypair`
- `sb2VerifySignature`
- `sb2Decrypt`
- `putPublic`
- `deletePublic`
- `publicGet`
- `signOutSession`
- `resumeSessionFromCookie`

The five artifacts below are byte-identical to `paykit-wasm/pkg` at that commit
(`git rev-parse HEAD` = `f753cb23d4e97b219d6fb83f7a0d60b67500c9bc`). SHA-256
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
| `paykit_wasm_bg.wasm` | `17bcdf1c3976e3fdb86ab48415a8ebbf99ffb0d1239b061d0f4b09631d296a14` |
| `paykit_wasm.js` | `0204a70849e38ed3d92b5481f1618b6382fd10b19a2497beb4f50299d046750a` |
| `paykit_wasm.d.ts` | `c6be3ae026d78565f8f7c25da1e83461e6973eeb8bc5a6ecd23cb248d5e32d75` |
| `paykit_wasm_bg.wasm.d.ts` | `7256a20f37368c6734e7e3eca4cc5a621d1ff64ff19e4ca4f64a1c26f986353e` |
| `package.json` | `374e0391c23bfa4e56d0a2819c6823bc7a1c83a7ca79c9032a5e4cadd40c261a` |

Generated package size: ~1.6 MB (wasm ~1.55 MB). `wasm-opt` output is not
guaranteed bit-identical across platforms; treat these checksums as a record
of this build, and re-record when the pin or toolchain changes.

## Re-vendor

```bash
git clone https://github.com/BitcoinErrorLog/paykit-rs-official.git
cd paykit-rs-official && git checkout f753cb23d4e97b219d6fb83f7a0d60b67500c9bc
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
