export type PaykitWasmModule = typeof import("paykit-wasm");

let wasmModulePromise: Promise<PaykitWasmModule> | null = null;

/**
 * Loads and initializes the vendored paykit-wasm binding once. The dynamic
 * import keeps the WASM binary out of the server-rendered module graph.
 * A failed init is retryable on the next call.
 */
export async function loadPaykitWasm(): Promise<PaykitWasmModule> {
  if (typeof window === "undefined") {
    throw new Error("paykit-wasm can only be initialized in a browser");
  }

  wasmModulePromise ??= (async () => {
    const sdk = await import("paykit-wasm");
    await sdk.default();
    return sdk;
  })();

  try {
    return await wasmModulePromise;
  } catch (error) {
    wasmModulePromise = null;
    throw error;
  }
}
