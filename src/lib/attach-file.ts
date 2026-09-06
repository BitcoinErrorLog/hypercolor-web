import { ATTACHMENT_MAX_BYTES } from "@/flags/config";
import { isRasterImageContentType } from "@/lib/attachment-preview";

const BLOCKED_TYPES = new Set([
  "application/x-msdownload",
  "application/x-executable",
  "application/x-dosexec",
  "application/javascript",
  "text/html",
  "application/xhtml+xml",
]);

export type AttachValidation =
  | { ok: true; file: File }
  | { ok: false; reason: "too-large" | "blocked-type" | "empty" };

export function validateAttachFile(file: File, maxBytes = ATTACHMENT_MAX_BYTES): AttachValidation {
  if (file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > maxBytes) return { ok: false, reason: "too-large" };
  const type = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  if (type && BLOCKED_TYPES.has(type)) return { ok: false, reason: "blocked-type" };
  return { ok: true, file };
}

export function attachValidationMessage(reason: "too-large" | "blocked-type" | "empty"): string {
  switch (reason) {
    case "too-large":
      return "This file is larger than 8 MiB.";
    case "blocked-type":
      return "That file type cannot be attached.";
    case "empty":
      return "That file is empty.";
    default:
      return "Could not attach this file.";
  }
}

export function clipboardImageFile(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;
  for (const item of items) {
    if (item.kind === "file" && isRasterImageContentType(item.type)) {
      return item.getAsFile();
    }
  }
  return null;
}

export function dataTransferFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files);
}
