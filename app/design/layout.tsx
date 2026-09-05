import { Suspense, type ReactNode } from "react";

export default function DesignLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="hc-boot-iridescent min-h-screen" />}>{children}</Suspense>
  );
}
