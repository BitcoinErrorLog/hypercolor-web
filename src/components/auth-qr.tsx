"use client";

import { useMemo } from "react";
import { AUTH_QR_SIZE_PT, generateAuthQrDataUri } from "@/lib/auth-qr";

export function AuthQr({
  value,
  testID = "authQr",
}: {
  value: string;
  testID?: string;
}) {
  const dataUri = useMemo(
    () => (value ? generateAuthQrDataUri(value) : null),
    [value],
  );
  if (!value || !dataUri) return null;

  return (
    <div data-testid={testID} className="mx-auto w-fit hc-qr-frame" data-surface="auth-qr">
      {/* data URI QR — next/image is not used for generated PNGs */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUri}
        alt="Authorization QR code"
        width={AUTH_QR_SIZE_PT}
        height={AUTH_QR_SIZE_PT}
        className="block"
      />
    </div>
  );
}
