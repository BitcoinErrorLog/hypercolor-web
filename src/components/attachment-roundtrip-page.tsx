"use client";

import { useEffect } from "react";
import {
  runAttachmentDelete,
  runAttachmentPublicDecrypt,
  runAttachmentSignupUpload,
} from "@/services/attachments/attachmentRoundtrip";

declare global {
  interface Window {
    runAttachmentSignupUpload?: typeof runAttachmentSignupUpload;
    runAttachmentPublicDecrypt?: typeof runAttachmentPublicDecrypt;
    runAttachmentDelete?: typeof runAttachmentDelete;
  }
}

export function AttachmentRoundtripPage() {
  useEffect(() => {
    window.runAttachmentSignupUpload = runAttachmentSignupUpload;
    window.runAttachmentPublicDecrypt = runAttachmentPublicDecrypt;
    window.runAttachmentDelete = runAttachmentDelete;
  }, []);

  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">
        Attachment staging harness
      </h1>
      <p className="text-sm text-muted-foreground leading-6">
        Dev/e2e only. Playwright calls <code>window.runAttachmentSignupUpload</code>
        , <code>runAttachmentPublicDecrypt</code>, and <code>runAttachmentDelete</code>.
        Signup tokens and attachment keys are not rendered.
      </p>
    </article>
  );
}
