/**
 * Node/Playwright loader for vendored paykit-wasm.
 * Uses a file URL so Playwright's CJS transpile can still dynamic-import ESM.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  computeInboxKid,
  sb2Decrypt,
  sb2Encrypt,
  sb2Sign,
  sb2VerifySignature,
  x25519GenerateKeypair,
} from "paykit-wasm";

export type X25519HexPair = {
  publicKey: string;
  secretKey: string;
};

export type PaykitWasmNode = {
  computeInboxKid: typeof computeInboxKid;
  sb2Decrypt: typeof sb2Decrypt;
  sb2Encrypt: typeof sb2Encrypt;
  sb2Sign: typeof sb2Sign;
  sb2VerifySignature: typeof sb2VerifySignature;
  x25519GenerateKeypair: typeof x25519GenerateKeypair;
};

type WasmInit = {
  default: (opts: { module_or_path: Buffer }) => Promise<unknown>;
};

let ready: Promise<PaykitWasmNode> | null = null;

export function loadPaykitWasmNode(): Promise<PaykitWasmNode> {
  ready ??= (async () => {
    const pkgDir = join(process.cwd(), "vendor", "paykit-wasm");
    const sdk = (await import(pathToFileURL(join(pkgDir, "paykit_wasm.js")).href)) as PaykitWasmNode &
      WasmInit;
    await sdk.default({ module_or_path: await readFile(join(pkgDir, "paykit_wasm_bg.wasm")) });
    return sdk;
  })();
  return ready;
}

export function asX25519HexPair(value: object): X25519HexPair {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as X25519HexPair).publicKey !== "string" ||
    typeof (value as X25519HexPair).secretKey !== "string" ||
    !/^[0-9a-f]{64}$/.test((value as X25519HexPair).publicKey) ||
    !/^[0-9a-f]{64}$/.test((value as X25519HexPair).secretKey)
  ) {
    throw new Error("x25519GenerateKeypair did not return hex publicKey/secretKey");
  }
  return value as X25519HexPair;
}
