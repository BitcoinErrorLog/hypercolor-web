import { bytesToHex, hexToBytes } from "@/lib/hex";

const HEX64 = /^[0-9a-f]{64}$/i;

export function extractBolt11Preimage(proof: Record<string, unknown>): string | null {
  if (typeof proof.data !== "string") return null;
  if (!HEX64.test(proof.data)) return null;
  return proof.data.toLowerCase();
}

/**
 * Verify a bolt11 preimage against a payment_hash we already possess.
 * SHA-256 over the 32-byte preimage (not the hex string).
 */
export async function verifyBolt11Preimage(
  preimageHex: string,
  paymentHashHex: string,
): Promise<boolean> {
  if (!HEX64.test(preimageHex) || !HEX64.test(paymentHashHex)) return false;
  const bytes = hexToBytes(preimageHex.toLowerCase());
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest)) === paymentHashHex.toLowerCase();
}
