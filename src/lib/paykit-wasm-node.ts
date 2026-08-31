/**
 * Node/Vitest loader for vendored paykit-wasm.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PaykitWasmModule } from "@/lib/paykit-wasm";

type WasmInit = {
  default: (opts: { module_or_path: Buffer }) => Promise<unknown>;
};

let ready: Promise<PaykitWasmModule> | null = null;

export function loadPaykitWasmNode(): Promise<PaykitWasmModule> {
  ready ??= (async () => {
    const pkgDir = join(process.cwd(), "vendor", "paykit-wasm");
    const sdk = (await import(pathToFileURL(join(pkgDir, "paykit_wasm.js")).href)) as PaykitWasmModule &
      WasmInit;
    await sdk.default({ module_or_path: await readFile(join(pkgDir, "paykit_wasm_bg.wasm")) });
    return sdk;
  })();
  return ready;
}
