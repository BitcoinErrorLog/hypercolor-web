# DO NOT USE THIS WHEN BUILDING.

## Historical provenance

This directory is a historical binary archive copied from the Paykit WASM
package at commit `d4a73a5765e1f0b18ed451d78f98dab97c611a8c`
(`0.1.0-rc50`) on 2026-09-01.

The recorded source repository was
`https://github.com/BitcoinErrorLog/paykit-rs-official`, branch
`fix/wasm-homeserver-write-abort`. Its upstream reference was
`https://github.com/pubky/paykit-rs` at
`c8892f638951f033acbcd12804a31667a81ddc14`, with `pubky-crypto` at
`01eb3e6575cf8c707ad0675962581e13aa4da0f0`.

The archived package contained these files and recorded SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `paykit_wasm_bg.wasm` | `fe41d70bfb4a23ec7e21713998cf960318a84ab3845775f62211a0f0bfb3024d` |
| `paykit_wasm.js` | `df0e5f7804ee62bd4b880c2f532635afe9e47c5cd06c766c95df4eec47db6392` |
| `paykit_wasm.d.ts` | `bf0696f9d72fc02310a6a1815a99b41b1be768020f3a41199cc337ce54dc2398` |
| `paykit_wasm_bg.wasm.d.ts` | `cebe23ebf38336009e38e3e7627d7df503b54fba24e18ae1abb33834c93941c0` |
| `package.json` | `043f33bb2b4fdb2602b609e5138b68b506937953d0c1775ccc624eb27238764f` |

The source-build record used Rust `1.93.1`, Cargo `1.93.1`,
wasm-bindgen `0.2.115`, and the `wasm32-unknown-unknown` target. The archived
package was approximately 1.8 MB. A separate historical comparison recorded
platform-dependent differences in the WASM data section while the JavaScript,
type declarations, package metadata, and other WASM section lengths matched.

This archive is never imported, built, or used by Hypercolor. It is retained
only as historical provenance; it is not a product dependency or a supported
build input.
