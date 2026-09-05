"use client";

import { useState } from "react";
import { formatPublicKey } from "@/lib/formatPublicKey";

export function PopoverPublicKey({ pubky }: { pubky: string }) {
  const [open, setOpen] = useState(false);
  const short = formatPublicKey({ key: pubky });
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="truncate text-xs font-medium tracking-[1.2px] text-muted-foreground uppercase"
        onClick={() => setOpen((v) => !v)}
      >
        {short}
      </button>
      {open ? (
        <span className="absolute top-full left-0 z-50 mt-1 max-w-xs break-all rounded-md border border-border bg-card p-2 font-mono text-xs text-foreground">
          {pubky}
        </span>
      ) : null}
    </span>
  );
}
