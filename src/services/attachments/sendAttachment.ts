import { ATTACHMENT_MAX_BYTES } from "@/flags/config";
import { KeyStore } from "@/services/KeyStore";
import { StorageService } from "@/services/StorageService";
import { GroupService } from "@/services/group/GroupService";
import { LinkService } from "@/services/link/LinkService";
import { isLinkNativeError } from "@/services/link/PaykitLinkWeb";
import {
  attachmentCachePath,
  writeFileFromStandardBase64,
} from "./fileIo";
import { AttachmentService } from "./AttachmentService";
import {
  ATTACHMENT_ALGORITHM,
  AttachmentError,
  attachmentKeyRef,
  buildAttachmentEnvelope,
  CHAT_ATTACHMENT_KIND,
  type AttachmentRecord,
} from "@/types/attachment";
import { buildDmConversationId, type LinkDeliveryState } from "@/types/link";

export type AttachmentSendTarget =
  | { type: "conversation"; peerPubky: string }
  | { type: "channel"; channelId: string };

function bytesToStandardB64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function attachmentDeliveryFromLink(state: LinkDeliveryState): AttachmentRecord["deliveryState"] {
  if (state === "sending" || state === "failed" || state === "sent") return state;
  return "delivered";
}

function attachmentPreviewBody(): string {
  return "Attachment";
}

/**
 * Encrypt via the proven homeserver path, persist KeyStore material, then
 * send the access PAM over the existing Encrypted Link (DM or group fan-out).
 */
export async function sendAttachmentFromBytes(
  target: AttachmentSendTarget,
  plaintext: Uint8Array,
  contentType: string,
): Promise<AttachmentRecord> {
  const owner = await KeyStore.getPubky();
  if (!owner) {
    throw new AttachmentError("unavailable", "Enable encrypted messaging to send attachments.");
  }
  const mime = contentType.trim();
  if (mime.length === 0) {
    throw new AttachmentError("validation", "contentType is required");
  }
  if (plaintext.byteLength === 0) {
    throw new AttachmentError("validation", "Attachment plaintext is empty");
  }
  if (plaintext.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new AttachmentError(
      "too-large",
      `Attachment is ${plaintext.byteLength} bytes; v1 limit is ${ATTACHMENT_MAX_BYTES} bytes (8 MiB).`,
    );
  }

  if (target.type === "channel") {
    const channel = await StorageService.getGroupChannel(owner, target.channelId);
    if (!channel) throw new AttachmentError("not-found", "Channel not found");
    if (channel.isPublic) {
      throw new AttachmentError(
        "unsupported-target",
        "Encrypted attachments require a private Encrypted Link. Public channels cannot carry attachment keys.",
      );
    }
  }

  const copy = new Uint8Array(plaintext.byteLength);
  copy.set(plaintext);
  const uploaded = await AttachmentService.encryptAndPut(plaintext);
  const eventId = crypto.randomUUID();
  const sentAt = Date.now();

  await KeyStore.setAttachmentSecret(owner, owner, eventId, {
    key: uploaded.key,
    nonce: uploaded.nonce,
    algorithm: uploaded.algorithm || ATTACHMENT_ALGORITHM,
  });

  const built = buildAttachmentEnvelope({
    eventId,
    sentAt,
    location: uploaded.location,
    key: uploaded.key,
    nonce: uploaded.nonce,
    algorithm: uploaded.algorithm || ATTACHMENT_ALGORITHM,
    contentType: mime,
    size: uploaded.size,
    ...(target.type === "channel" ? { channelId: target.channelId } : {}),
  });

  const conversationId =
    target.type === "conversation" ? buildDmConversationId(target.peerPubky) : null;
  const channelId = target.type === "channel" ? target.channelId : null;
  const cachePath = attachmentCachePath(owner, owner, eventId);
  await writeFileFromStandardBase64(cachePath, bytesToStandardB64(copy));

  const record: AttachmentRecord = {
    ownerPubky: owner,
    eventId,
    conversationId,
    channelId,
    senderPubky: owner,
    direction: "sent",
    location: uploaded.location,
    keyRef: attachmentKeyRef(owner, owner, eventId),
    contentType: mime,
    size: uploaded.size,
    thumbnailLocation: built.envelope.thumbnail?.location ?? null,
    localCachePath: cachePath,
    createdAt: sentAt,
    updatedAt: sentAt,
    deliveryState: "sending",
    resolveState: "ready",
  };
  await StorageService.saveAttachment(record);

  try {
    if (target.type === "conversation") {
      const sent = await LinkService.sendPreparedMessage({
        peerPubky: target.peerPubky,
        kind: CHAT_ATTACHMENT_KIND,
        eventId,
        rawJson: built.json,
        body: attachmentPreviewBody(),
        sentAt,
      });
      const deliveryState = attachmentDeliveryFromLink(sent.deliveryState);
      await StorageService.updateAttachmentDelivery(owner, owner, eventId, deliveryState);
      return { ...record, deliveryState, updatedAt: Date.now() };
    }
    const sent = await GroupService.sendPreparedFanout({
      channelId: target.channelId,
      kind: CHAT_ATTACHMENT_KIND,
      eventId,
      sentAt,
      body: attachmentPreviewBody(),
      rawJson: built.json,
    });
    const deliveryState = attachmentDeliveryFromLink(sent.deliveryState);
    await StorageService.updateAttachmentDelivery(owner, owner, eventId, deliveryState);
    return { ...record, deliveryState, updatedAt: Date.now() };
  } catch (err) {
    await StorageService.updateAttachmentDelivery(owner, owner, eventId, "failed");
    if (err instanceof AttachmentError) throw err;
    if (isLinkNativeError(err)) {
      throw new AttachmentError(
        err.code === "unavailable" ? "unavailable" : "network",
        err.message,
      );
    }
    throw new AttachmentError("network", err instanceof Error ? err.message : String(err));
  }
}
