import {
  AttachmentError,
  isValidAttachmentThumbnailLocation,
  parseAttachmentLocation,
} from "@/types/attachment";
import {
  createLinkNativeError,
  isLinkNativeError,
  PaykitLinkWeb,
  toLinkNativeError,
  type LinkNativeError,
} from "../link/PaykitLinkWeb";
import { getLiveSession } from "../link/session";

export type AttachmentHomeserverTarget = {
  ownerPubky: string;
  path: string;
};

/**
 * Canonical attachment (or `.thumb`) location → owner + homeserver path.
 * Path is `/pub/hypercolor.app/v1/attachments/{uuid}` (plus `.thumb`).
 */
export function attachmentHomeserverTarget(
  location: string,
): AttachmentHomeserverTarget {
  const thumb = location.endsWith(".thumb");
  const main = thumb ? location.slice(0, -".thumb".length) : location;
  const parsed = parseAttachmentLocation(main);
  if (!parsed) {
    throw new AttachmentError("validation", "Attachment location is not canonical");
  }
  if (thumb && !isValidAttachmentThumbnailLocation(main, location)) {
    throw new AttachmentError(
      "validation",
      "Attachment thumbnail location is not canonical",
    );
  }
  return {
    ownerPubky: parsed.ownerPubky,
    path: `/pub/hypercolor.app/v1/attachments/${parsed.attachmentId}${
      thumb ? ".thumb" : ""
    }`,
  };
}

export function mapLinkErrorToAttachment(err: unknown): AttachmentError {
  if (err instanceof AttachmentError) return err;
  const mapped: LinkNativeError = isLinkNativeError(err)
    ? err
    : toLinkNativeError(err);
  if (mapped.code === "unavailable" || mapped.code === "auth") {
    return new AttachmentError("unavailable", mapped.message);
  }
  if (mapped.code === "network") {
    return new AttachmentError("network", mapped.message);
  }
  if (mapped.code === "validation") {
    return new AttachmentError("validation", mapped.message);
  }
  return new AttachmentError("protocol", mapped.message);
}

function requireOwnerSession(ownerPubky: string) {
  const live = getLiveSession();
  if (!live) {
    throw mapLinkErrorToAttachment(
      createLinkNativeError(
        "auth",
        "Enable encrypted messaging to write to your homeserver.",
      ),
    );
  }
  if (live.pubky !== ownerPubky) {
    throw new AttachmentError(
      "validation",
      "Attachment location is not owned by the live session",
    );
  }
  return live;
}

/**
 * Authenticated PUT of attachment ciphertext. Body is UTF-8 of the
 * unpadded base64url sealed blob (mobile `PubkyService.put` wire).
 */
export async function putAttachmentCiphertext(
  location: string,
  ciphertextB64: string,
): Promise<void> {
  const target = attachmentHomeserverTarget(location);
  const live = requireOwnerSession(target.ownerPubky);
  if (ciphertextB64.length === 0) {
    throw new AttachmentError("validation", "Attachment ciphertext is empty");
  }
  try {
    await PaykitLinkWeb.putPublic(
      live.handle,
      target.path,
      new TextEncoder().encode(ciphertextB64),
    );
  } catch (err) {
    throw mapLinkErrorToAttachment(err);
  }
}

/**
 * Public GET of attachment ciphertext. 404 → `null`.
 */
export async function getAttachmentCiphertext(
  location: string,
): Promise<string | null> {
  const target = attachmentHomeserverTarget(location);
  let raw: Uint8Array | undefined;
  try {
    raw = await PaykitLinkWeb.publicGet(target.ownerPubky, target.path);
  } catch (err) {
    throw mapLinkErrorToAttachment(err);
  }
  if (raw === undefined) return null;
  const text = new TextDecoder().decode(raw);
  return text.length > 0 ? text : null;
}

export async function deleteAttachmentCiphertext(location: string): Promise<void> {
  const target = attachmentHomeserverTarget(location);
  const live = requireOwnerSession(target.ownerPubky);
  try {
    await PaykitLinkWeb.deletePublic(live.handle, target.path);
  } catch (err) {
    throw mapLinkErrorToAttachment(err);
  }
}
