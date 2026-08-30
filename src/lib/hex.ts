import { hex } from "@scure/base";

export function hexToBytes(value: string): Uint8Array {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length % 2 !== 0 || !/^[0-9a-f]+$/.test(trimmed)) {
    throw new Error("hexToBytes: expected even-length hex");
  }
  return hex.decode(trimmed);
}

export function bytesToHex(bytes: Uint8Array): string {
  return hex.encode(bytes);
}

export function isEvenHex(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}

export function zeroizeBytes(bytes: Uint8Array): void {
  bytes.fill(0);
}
