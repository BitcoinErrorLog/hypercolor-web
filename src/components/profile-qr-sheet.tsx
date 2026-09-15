"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AuthQr } from "@/components/auth-qr";
import { Button } from "@/components/ui/button";
import { ModalSheet } from "@/components/ui/sheet";
import { canonicalPubkyUri } from "@/lib/pubkyPayload";

export function ProfileQrSheet({
  pubky,
  open,
  onClose,
  restoreFocus,
}: {
  pubky: string;
  open: boolean;
  onClose: () => void;
  restoreFocus?: () => HTMLElement | null;
}) {
  const copyRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const payload = useMemo(() => canonicalPubkyUri(pubky), [pubky]);

  const copyPayload = useCallback(async () => {
    await navigator.clipboard.writeText(payload);
    setCopied(true);
  }, [payload]);

  const sharePayload = useCallback(async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Pubky", text: payload });
        setShared(true);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await navigator.clipboard.writeText(payload);
    setShared(true);
  }, [payload]);

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      titleId="profile-qr-title"
      descriptionId="profile-qr-body"
      initialFocusRef={copyRef}
      restoreFocus={restoreFocus}
      testId="profileQrSheet"
      surface="profile-qr-sheet"
    >
      <h2 id="profile-qr-title" className="text-lg font-semibold">
        Your pubky
      </h2>
      <p id="profile-qr-body" className="text-sm text-muted-foreground">
        Scan this QR or copy the canonical pubky URI.
      </p>
      <AuthQr value={payload} testID="profileQrImage" alt="Pubky QR code" />
      <p className="break-all font-mono text-sm tracking-[1.2px]" data-testid="profileQrPayload">
        {payload}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          ref={copyRef}
          size="sm"
          data-testid="profileQrCopy"
          onClick={() => {
            void copyPayload();
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="profileQrShare"
          onClick={() => {
            void sharePayload();
          }}
        >
          {shared ? "Shared" : "Share"}
        </Button>
      </div>
    </ModalSheet>
  );
}
