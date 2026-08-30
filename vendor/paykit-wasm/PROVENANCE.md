# paykit-wasm provenance

Vendored browser WASM binding for the Paykit Encrypted Link messaging surface.
Copied from the official checkout's `paykit-wasm/pkg` at the recorded HEAD —
not rebuilt, and not the older mp-dm pin `7bbaba0447724776a1f52f8f581bcbcaf6dd67d2`.

## Source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/BitcoinErrorLog/paykit-rs-official` |
| Branch | `feat/wasm-binding` |
| Commit | `132628c1622de4a76c1c52e0033aae225d087732` |
| Upstream | `https://github.com/pubky/paykit-rs` |
| Upstream pin | `c8892f638951f033acbcd12804a31667a81ddc14` (tag anchor v0.1.0-rc43) |
| Package path | `paykit-wasm/pkg` |
| Package name | `paykit-wasm` |
| Package version | `0.1.0-rc44` |
| License | MIT |

This HEAD adds `PubkyClient.resumeSessionFromCookie`. The five artifacts below
are byte-identical to `paykit-wasm/pkg` at that commit (checksums match the
binding README at the same HEAD).

## Toolchain (recorded at the source build)

| Tool | Version |
| --- | --- |
| `wasm-pack` | 0.13.1 (bundled binaryen `wasm-opt`) |
| `rustc` | 1.93.1 (01f6ddf75 2026-02-11) |
| `wasm-bindgen` | 0.2.115 |
| Rust target | `wasm32-unknown-unknown` |
| Node (smoke test) | v22.14.0 |

## Artifact checksums (SHA-256)

| File | SHA-256 |
| --- | --- |
| `paykit_wasm_bg.wasm` | `cd781e364126312453b014ba3ceb74055a0c3f8b26c70b41e4827a0991ba4096` |
| `paykit_wasm.js` | `ee73963f128b8b2667391721b3ed3a025527d4b89ade26cd1522c47cf9746587` |
| `paykit_wasm.d.ts` | `c88bda8479479e6dd548542a3b380b7224dcab28cca572936d69cf8013930887` |
| `paykit_wasm_bg.wasm.d.ts` | `b390e8c1ebd8ec5ed148bd51aa8891ca7b6688d35fe744b90bd4615cf86cf5bb` |
| `package.json` | `374e0391c23bfa4e56d0a2819c6823bc7a1c83a7ca79c9032a5e4cadd40c261a` |

Generated package size: ~1.5 MB (wasm ~1.45 MB). `wasm-opt` output is not
guaranteed bit-identical across platforms; treat these checksums as a record
of this build, and re-record when the pin or toolchain changes.

## Re-vendor

```bash
git clone https://github.com/BitcoinErrorLog/paykit-rs-official.git
cd paykit-rs-official && git checkout 132628c1622de4a76c1c52e0033aae225d087732
rustup target add wasm32-unknown-unknown
wasm-pack build paykit-wasm --target web --out-dir pkg --release
# copy package.json, paykit_wasm.js, paykit_wasm.d.ts,
# paykit_wasm_bg.wasm, paykit_wasm_bg.wasm.d.ts into vendor/paykit-wasm/
npm install
node scripts/paykit-wasm-smoke.mjs
```

Then update the commit pin, toolchain table, and checksums in this file.

The app references the package as `"paykit-wasm": "file:vendor/paykit-wasm"`.
Load it only through `src/lib/paykit-wasm.ts` (dynamic import). Never import
the WASM module at module scope on the server.

This page does **not** set COOP/COEP. The binding does not need SharedArrayBuffer.
P1 will use `opfs-sahpool` + Web Locks, not the default sqlite OPFS VFS.
