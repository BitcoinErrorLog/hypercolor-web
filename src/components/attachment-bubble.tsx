"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorDetails } from "@/components/error-details";
import { isRasterImageContentType } from "@/lib/attachment-preview";
import { KeyStore } from "@/services/KeyStore";
import { AttachmentService } from "@/services/attachments/AttachmentService";
import { AttachmentError, type AttachmentRecord } from "@/types/attachment";
import { emitCoarseError } from "@/services/vibeware/coarse";

const ATTACHMENT_DECRYPT_ERROR = "Could not decrypt this attachment.";

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

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const unavailable = record.resolveState === "unavailable-from-backup";

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
      const copy = new Uint8Array(plaintext.byteLength);
      copy.set(plaintext);
      const blob = new Blob([copy.buffer], { type: record.contentType });
      const nextUrl = URL.createObjectURL(blob);
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decrypt failed");
      emitCoarseError("attachment", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-background/40 p-3 text-sm" data-surface="attachment-bubble">
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
      {isRasterImageContentType(record.contentType) && objectUrl ? (
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
          {busy ? "Decrypting…" : "Decrypt"}
        </Button>
      ) : null}
      {error ? <ErrorDetails fallback={ATTACHMENT_DECRYPT_ERROR} details={error} /> : null}
    </div>
  );
}
