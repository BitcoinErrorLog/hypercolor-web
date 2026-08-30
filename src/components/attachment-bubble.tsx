"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { KeyStore } from "@/services/KeyStore";
import { StorageService } from "@/services/StorageService";
import { AttachmentService } from "@/services/attachments/AttachmentService";
import {
  attachmentCachePath,
  writeFileFromStandardBase64,
} from "@/services/attachments/fileIo";
import { AttachmentError, isImageContentType, type AttachmentRecord } from "@/types/attachment";

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

export function AttachmentBubble({
  record,
  onResolved,
}: {
  record: AttachmentRecord;
  onResolved?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  const unavailable = record.resolveState === "unavailable-from-backup";
  const ready = record.resolveState === "ready" || Boolean(record.localCachePath);

  async function decrypt() {
    setBusy(true);
    setError(null);
    try {
      const secret = await KeyStore.getAttachmentSecret(
        record.ownerPubky,
        record.senderPubky,
        record.eventId,
      );
      if (!secret) {
        throw new AttachmentError("not-found", "Attachment key is not on this device.");
      }
      const plaintext = await AttachmentService.getAndDecrypt(
        record.location,
        secret.key,
        secret.nonce,
      );
      const cachePath = attachmentCachePath(
        record.ownerPubky,
        record.senderPubky,
        record.eventId,
      );
      await writeFileFromStandardBase64(cachePath, bytesToStandardB64(plaintext));
      await StorageService.updateAttachmentResolve(
        record.ownerPubky,
        record.senderPubky,
        record.eventId,
        { resolveState: "ready", localCachePath: cachePath },
      );
      const copy = new Uint8Array(plaintext.byteLength);
      copy.set(plaintext);
      const blob = new Blob([copy.buffer], { type: record.contentType });
      setObjectUrl(URL.createObjectURL(blob));
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decrypt failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-background/40 p-3 text-sm">
      <p className="font-medium">Attachment</p>
      <p className="text-muted-foreground">
        {record.contentType} · {record.size} bytes
        {record.deliveryState === "failed" ? " · failed" : ""}
        {record.deliveryState === "sending" ? " · sending" : ""}
      </p>
      {unavailable ? (
        <p className="text-muted-foreground">
          Unavailable from backup until this file is shared again.
        </p>
      ) : null}
      {isImageContentType(record.contentType) && objectUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={objectUrl} alt="Attachment" className="max-h-64 rounded-md" />
      ) : objectUrl ? (
        <a href={objectUrl} download className="underline underline-offset-4">
          Download decrypted file
        </a>
      ) : null}
      {!unavailable && !objectUrl ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void decrypt()}
        >
          {busy ? "Decrypting…" : ready ? "Open" : "Decrypt"}
        </Button>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
