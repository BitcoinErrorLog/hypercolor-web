"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalSheet } from "@/components/ui/sheet";

export const SCAN_UNSUPPORTED_MESSAGE =
  "Scanning not supported in this browser — paste the pubky instead";
export const SCAN_DENIED_MESSAGE =
  "Camera permission was denied. Paste the pubky instead.";

export type ContactScannerFixture = "unsupported" | "denied" | "scanning";

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function barcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

function scanningSupported(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(barcodeDetectorCtor());
}

export function ContactQrScanner({
  open,
  onClose,
  onDecoded,
  fixture,
}: {
  open: boolean;
  onClose: () => void;
  onDecoded: (raw: string) => void;
  fixture?: ContactScannerFixture;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  const error =
    fixture === "unsupported"
      ? SCAN_UNSUPPORTED_MESSAGE
      : fixture === "denied"
        ? SCAN_DENIED_MESSAGE
        : liveError ??
          (open && !fixture && typeof navigator !== "undefined" && !scanningSupported()
            ? SCAN_UNSUPPORTED_MESSAGE
            : null);

  useEffect(() => {
    if (!open || fixture || !scanningSupported()) return;
    const Detector = barcodeDetectorCtor();
    if (!Detector) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    const detector = new Detector({ formats: ["qr_code"] });

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(video);
            const raw = codes.find((code) => code.rawValue)?.rawValue;
            if (raw) {
              onDecoded(raw);
              return;
            }
          } catch {
            // Keep scanning while the camera is live.
          }
          frame = window.requestAnimationFrame(() => {
            void tick();
          });
        };
        frame = window.requestAnimationFrame(() => {
          void tick();
        });
      } catch (err) {
        const denied =
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
        if (!cancelled) setLiveError(denied ? SCAN_DENIED_MESSAGE : SCAN_UNSUPPORTED_MESSAGE);
      }
    })();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, fixture, onDecoded]);

  return (
    <ModalSheet
      open={open}
      onClose={close}
      titleId="contact-scan-title"
      descriptionId="contact-scan-body"
      initialFocusRef={closeRef}
      testId="contactScanner"
      surface="contact-scanner"
    >
      <h2 id="contact-scan-title" className="text-lg font-semibold">
        {error === SCAN_UNSUPPORTED_MESSAGE
          ? "Scanning not supported"
          : error === SCAN_DENIED_MESSAGE
            ? "Camera permission denied"
            : "Scan a pubky QR"}
      </h2>
      <p id="contact-scan-body" className="text-sm text-muted-foreground">
        Point the camera at a pubky QR, or paste the pubky on the contacts form.
      </p>
      {error ? (
        <p className="text-sm hc-warning-text" data-testid="contactScanError" role="alert">
          {error}
        </p>
      ) : (
        <video
          ref={videoRef}
          className="aspect-square w-full rounded-lg bg-black object-cover"
          playsInline
          muted
          autoPlay
        />
      )}
      <Button type="button" size="sm" variant="outline" ref={closeRef} onClick={close}>
        Close
      </Button>
    </ModalSheet>
  );
}
