import { loadPaykitWasm, type PaykitWasmModule } from "@/lib/paykit-wasm";
import type { AppCert } from "@/services/KeyStore";
import type { HandoffPayload } from "@/services/RingConnect";

export type HandoffAppKey = NonNullable<HandoffPayload["app_key"]>;

async function loadPaykitWasmRuntime(): Promise<PaykitWasmModule> {
  if (typeof window !== "undefined") {
    return loadPaykitWasm();
  }
  // Node/Vitest only. webpackIgnore keeps this out of the client graph —
  // bundling paykit-wasm-node (expression import) HMR-stalls Enable after
  // Ring approval so setEnabled never paints.
  const { loadPaykitWasmNode } = await import(
    /* webpackIgnore: true */ "@/lib/paykit-wasm-node"
  );
  return loadPaykitWasmNode();
}

export async function verifyHandoffAppCert(
  issuerPubky: string,
  appKey: HandoffAppKey,
): Promise<AppCert> {
  const wasm = await loadPaykitWasmRuntime();
  const certIdHex = wasm.verifyAppCert(
    issuerPubky,
    appKey.cert_body,
    appKey.cert_sig,
  );
  if (certIdHex.toLowerCase() !== appKey.cert_id.toLowerCase()) {
    throw new Error("Handoff AppCert cert_id does not match verified signature");
  }
  return {
    certBodyHex: appKey.cert_body,
    sigHex: appKey.cert_sig,
    certIdHex: certIdHex.toLowerCase(),
  };
}

export async function isStoredAppCertValid(
  issuerPubky: string | null,
  cert: AppCert | null,
): Promise<boolean> {
  if (!issuerPubky || !cert) return false;
  if (cert.expiresAt != null && Math.floor(Date.now() / 1000) >= cert.expiresAt) {
    return false;
  }
  try {
    const verified = await verifyHandoffAppCert(issuerPubky, {
      ed25519_sk: "",
      ed25519_pk: "",
      cert_id: cert.certIdHex,
      cert_body: cert.certBodyHex,
      cert_sig: cert.sigHex,
    });
    return verified.certIdHex === cert.certIdHex.toLowerCase();
  } catch {
    return false;
  }
}
