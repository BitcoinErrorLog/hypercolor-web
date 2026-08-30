"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function PwaRegister() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith("/e2e")) return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js");
  }, [pathname]);

  return null;
}
