export const CHAT_KINDS_V = 1;
export const CHAT_KINDS_V_KEY = "chat_kinds_v";
export const RECEIVER_PATH = "hypercolor/wallet";
export const RECEIVER_MARKER_STORAGE_PATH = "/pub/paykit/v0/hypercolor/wallet/receiver.json";
export const LEGACY_RECEIVER_JSON_STORAGE_PATH = "/pub/paykit.app/v0/receiver.json";
export const CAPABILITY_KIND = "hypercolor.receiver.capabilities";
export const CAPABILITY_MAX_BYTES = 512;

export type ReceiverMarker = {
  version: 1;
  kind: "paykit.receiver";
  receiverPath: typeof RECEIVER_PATH;
  capabilities: {
    privatePayments: boolean;
    paymentRequests: boolean;
    receipts: boolean;
    outgoingPayments: boolean;
  };
  noisePublicKey: string;
};

export type HypercolorCapabilities = {
  version: 1;
  kind: typeof CAPABILITY_KIND;
  receiverPath: typeof RECEIVER_PATH;
  chatKindsV: number;
};

export type CapabilityParseResult =
  | { ok: true; value: HypercolorCapabilities }
  | { ok: false; error: "TOO_LARGE" | "INVALID" };

const Z32 = "ybndrfg8ejkmcpqxot1uwisza345h769";

function isZ32PublicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 52 || !/^[ybndrfg8ejkmcpqxot1uwisza345h769]+$/.test(value)) {
    return false;
  }
  let bits = 0;
  let count = 0;
  for (const char of value) {
    bits = (bits << 5) | Z32.indexOf(char);
    count += 5;
    if (count >= 8) count -= 8;
  }
  return count < 5 && (bits & ((1 << count) - 1)) === 0;
}

function parseJson(raw: string): unknown {
  const parsed = JSON.parse(raw) as unknown;
  const objects: Set<string>[] = [];
  let inString = false;
  let escaped = false;
  let token = "";
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (escaped) {
        token += char;
        escaped = false;
      } else if (char === "\\") {
        token += char;
        escaped = true;
      }
      else if (char === '"') {
        inString = false;
        let j = i + 1;
        while (/\s/.test(raw[j] ?? "")) j += 1;
        if (raw[j] === ":") {
          const key = JSON.parse(`${token}"`) as string;
          const current = objects.at(-1);
          if (current?.has(key)) throw new Error("duplicate JSON key");
          current?.add(key);
        }
        token = "";
      } else token += char;
      continue;
    }
    if (char === '"') {
      inString = true;
      token = '"';
    } else if (char === "{") objects.push(new Set());
    else if (char === "}") objects.pop();
  }
  return parsed;
}

function recordToObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeChatKindsV(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : 0;
}

export function parseReceiverMarkerJson(raw: string): ReceiverMarker | null {
  let parsed: unknown;
  try {
    parsed = parseJson(raw);
  } catch {
    return null;
  }
  const rec = recordToObject(parsed);
  const capabilities = recordToObject(rec?.capabilities);
  if (
    !rec ||
    Object.keys(rec).length !== 5 ||
    rec.version !== 1 ||
    rec.kind !== "paykit.receiver" ||
    rec.receiver_path !== RECEIVER_PATH ||
    !capabilities ||
    Object.keys(capabilities).length !== 4 ||
    typeof capabilities.private_payments !== "boolean" ||
    typeof capabilities.payment_requests !== "boolean" ||
    typeof capabilities.receipts !== "boolean" ||
    typeof capabilities.outgoing_payments !== "boolean" ||
    !isZ32PublicKey(rec.noise_public_key)
  ) {
    return null;
  }
  return {
    version: 1,
    kind: "paykit.receiver",
    receiverPath: RECEIVER_PATH,
    capabilities: {
      privatePayments: capabilities.private_payments,
      paymentRequests: capabilities.payment_requests,
      receipts: capabilities.receipts,
      outgoingPayments: capabilities.outgoing_payments,
    },
    noisePublicKey: rec.noise_public_key,
  };
}

export function capabilityPath(noisePublicKey: string): string {
  return `/pub/hypercolor.app/v1/receivers/${noisePublicKey}/capabilities.json`;
}

export function buildCapabilitiesJson(chatKindsV = CHAT_KINDS_V): string {
  if (!Number.isSafeInteger(chatKindsV) || chatKindsV < 1) {
    throw new Error("chat_kinds_v must be a positive safe integer");
  }
  return JSON.stringify({
    version: 1,
    kind: CAPABILITY_KIND,
    receiver_path: RECEIVER_PATH,
    chat_kinds_v: chatKindsV,
  });
}

export function parseCapabilitiesJson(raw: string): HypercolorCapabilities | null {
  const result = parseCapabilitiesJsonDetailed(raw);
  return result.ok ? result.value : null;
}

export function parseCapabilitiesJsonDetailed(raw: string): CapabilityParseResult {
  if (new TextEncoder().encode(raw).byteLength > CAPABILITY_MAX_BYTES) {
    return { ok: false, error: "TOO_LARGE" };
  }
  let parsed: unknown;
  try {
    parsed = parseJson(raw);
  } catch {
    return { ok: false, error: "INVALID" };
  }
  const rec = recordToObject(parsed);
  if (
    !rec ||
    Object.keys(rec).length !== 4 ||
    rec.version !== 1 ||
    rec.kind !== CAPABILITY_KIND ||
    rec.receiver_path !== RECEIVER_PATH ||
    normalizeChatKindsV(rec.chat_kinds_v) < 1
  ) {
    return { ok: false, error: "INVALID" };
  }
  return {
    ok: true,
    value: {
      version: 1,
      kind: CAPABILITY_KIND,
      receiverPath: RECEIVER_PATH,
      chatKindsV: rec.chat_kinds_v as number,
    },
  };
}

export function parseLegacyChatKindsVDetailed(raw: string): number | null {
  try {
    const parsed = parseJson(raw);
    const rec = recordToObject(parsed);
    return normalizeChatKindsV(rec?.[CHAT_KINDS_V_KEY]);
  } catch {
    return null;
  }
}

export function parseLegacyChatKindsV(raw: string): number {
  return parseLegacyChatKindsVDetailed(raw) ?? 0;
}
