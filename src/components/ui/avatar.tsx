"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Identicon } from "@/components/ui/identicon";

const avatarVariants = cva("relative flex shrink-0 overflow-hidden rounded-full", {
  variants: {
    size: {
      sm: "h-6 w-6",
      md: "h-8 w-8",
      default: "h-10 w-10",
      lg: "h-12 w-12",
      xl: "h-16 w-16",
    },
  },
  defaultVariants: { size: "default" },
});

const SIZE_PX = { sm: 24, md: 32, default: 40, lg: 48, xl: 64 } as const;

export function Avatar({
  className,
  size,
  src,
  alt,
  seed,
  ring,
}: VariantProps<typeof avatarVariants> & {
  className?: string;
  src?: string;
  alt?: string;
  seed: string;
  ring?: boolean;
}) {
  const px = SIZE_PX[size ?? "default"];
  const inner = (
    <span className={cn(avatarVariants({ size }), className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt ?? ""} className="aspect-square h-full w-full object-cover" />
      ) : (
        <Identicon seed={seed} size={px} />
      )}
    </span>
  );
  if (!ring) return inner;
  return <span className="hc-avatar-ring inline-flex shrink-0">{inner}</span>;
}

export function AvatarFallback({ seed, size = 40 }: { seed: string; size?: number }) {
  return <Identicon seed={seed} size={size} />;
}

export { avatarVariants };
