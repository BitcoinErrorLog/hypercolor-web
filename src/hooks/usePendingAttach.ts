"use client";

import { useCallback, useState } from "react";
import { attachValidationMessage, validateAttachFile } from "@/lib/attach-file";
import { ATTACHMENT_MAX_BYTES } from "@/flags/config";
import type { GifHit } from "@/components/gif-picker";

export function usePendingAttach(sendFile: (file: File) => Promise<void>) {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const offer = useCallback((file: File) => {
    const check = validateAttachFile(file);
    if (!check.ok) {
      setPendingError(attachValidationMessage(check.reason));
      setPendingFile(null);
      setPendingPreviewUrl(null);
      return;
    }
    setPendingError(null);
    setPendingFile(file);
    setPendingPreviewUrl(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
  }, []);

  const cancel = useCallback(() => {
    setPendingFile(null);
    setPendingPreviewUrl(null);
    setPendingError(null);
  }, []);

  const confirm = useCallback(async () => {
    if (!pendingFile) return;
    const file = pendingFile;
    cancel();
    await sendFile(file);
  }, [pendingFile, sendFile, cancel]);

  return { pendingFile, pendingPreviewUrl, pendingError, offer, cancel, confirm };
}

export async function fetchGifAsFile(hit: GifHit): Promise<File> {
  const res = await fetch(`/api/gif/fetch?id=${encodeURIComponent(hit.id)}`);
  if (res.status === 503) throw new Error("GIF search not configured");
  if (!res.ok) throw new Error("Could not download that GIF.");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > ATTACHMENT_MAX_BYTES) throw new Error("This file is larger than 8 MiB.");
  const type = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/gif";
  return new File([buf], `gif-${hit.id}.gif`, { type });
}
