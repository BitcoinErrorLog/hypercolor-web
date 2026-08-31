# paykit-wasm provenance

Vendored browser WASM binding for the Paykit Encrypted Link messaging
surface, Payment Endpoints, and homeserver migration. Copied from the
official checkout's `paykit-wasm/pkg` after a local `wasm-pack` rebuild
on `feat/homeserver-migration`. Not rebuilt inside this web tree.

## Source

| Field | Value |
| --- | --- |
| Repository | `https://github.com/BitcoinErrorLog/paykit-rs-official` |
| Branch | `feat/homeserver-migration` |
| Commit | `6a58d269fecdaa058c527890a3c39b0518e7cade` (local, unpushed) |
| Base | `feat/sb2-encrypt-export` @ `4c0b7a1` |
| Upstream | `https://github.com/pubky/paykit-rs` |
| `pubky` | crates.io `0.8.0` vendored at `vendor/pubky` with CAS retry, last-attempt If-Match omit, WASM backoff, `migrate_homeserver`, and ICANN/HTTP endpoint selection (see `vendor/pubky/PATCHES.md`) |
| `pubky-crypto` git dep | `https://github.com/BitcoinErrorLog/pubky-crypto.git` @ `01eb3e6575cf8c707ad0675962581e13aa4da0f0` |
| Package path | `paykit-wasm/pkg` |
| Package name | `paykit-wasm` |
| Package version | `0.1.0-rc47` |
| License | MIT |

This build keeps the previous Encrypted Link / SB2 / Payment Endpoint
surface and adds:

- `PubkyClient.migrateHomeserverWithSecret` — signup or 409→signin on the
  new host, then force-publish `_pubky`. Host-local data is not copied.
- Force-publish last CAS attempt omits If-Match; WASM retries sleep via
  `setTimeout`; `/signup` and `/session` retry on transport errors.
- `PubkyClient.resolveMostRecentHomeserver` — force fresh `_pubky` lookup
  after a counterparty migrates (bypasses stale pkarr cache).
- pkarr force-publish retries `UnexpectedResponses` with re-resolve (6 attempts).

## Toolchain (recorded at the source build)

| Tool | Version |
| --- | --- |
| `wasm-pack` | 0.13.1 (bundled binaryen `wasm-opt`) |
| `rustc` | 1.93.1 (01f6ddf75 2026-02-11) |
| `wasm-bindgen` | 0.2.115 |
| Rust target | `wasm32-unknown-unknown` |
| Build command | `wasm-pack build paykit-wasm --target web --out-dir pkg --release` |

## Artifact checksums (SHA-256)

Computed with `shasum -a 256` against the files copied into this directory.

| File | SHA-256 |
| --- | --- |
| `paykit_wasm_bg.wasm` | `d83ea2e0626151931448bb4929cba214f50236084e32252921ce9fcd548dd492` |
| `paykit_wasm.js` | `56a991159847382456bad25f136c8287ff6b3fdcf07505f423a7d01eee3b9be5` |
| `paykit_wasm.d.ts` | `5974284a8b5573fa5e0088e7809fa6f19b67bed12f5266ec6ea285852b5a3e5a` |
| `paykit_wasm_bg.wasm.d.ts` | `da8369fc7b6f279d4212c3c36ea575bc4e52c67e32ea205537cd9232b3b4114d` |
| `package.json` | `65e7d4a03984a38686323ac32cd2cf886a73538ae7a1c74f6f1f47cd6e27e7bf` |

Generated package size: ~1.8 MB (wasm ~1.8 MB). `wasm-opt` output is not
guaranteed bit-identical across platforms; treat these checksums as a record
of this build, and re-record when the pin or toolchain changes.

## Re-vendor

```bash
# In paykit-rs-official on feat/homeserver-migration:
wasm-pack build paykit-wasm --target web --out-dir pkg --release
# copy package.json, paykit_wasm.js, paykit_wasm.d.ts,
# paykit_wasm_bg.wasm, paykit_wasm_bg.wasm.d.ts into vendor/paykit-wasm/
shasum -a 256 vendor/paykit-wasm/{package.json,paykit_wasm.js,paykit_wasm.d.ts,paykit_wasm_bg.wasm,paykit_wasm_bg.wasm.d.ts}
# Do not run npm install in this tree (node_modules is a symlink off-disk).
node scripts/paykit-wasm-smoke.mjs
```

Then update the commit pin, toolchain table, and checksums in this file.

The app references the package as `"paykit-wasm": "file:vendor/paykit-wasm"`.
Load it only through `src/lib/paykit-wasm.ts` (dynamic import). Never import
the WASM module at module scope on the server.

This page does **not** set COOP/COEP. The binding does not need SharedArrayBuffer.
P1 will use `opfs-sahpool` + Web Locks, not the default sqlite OPFS VFS.
