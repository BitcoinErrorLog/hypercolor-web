"use client";

import type { ReactNode, Ref } from "react";
import { useTwoPane } from "@/hooks/useTwoPane";

export function DetailHeading({
  children,
  className,
  headingRef,
  testId,
}: {
  children: ReactNode;
  className: string;
  headingRef?: Ref<HTMLHeadingElement>;
  testId?: string;
}) {
  const twoPane = useTwoPane();
  if (twoPane) {
    return (
      <h2 ref={headingRef} tabIndex={-1} className={className} data-testid={testId}>
        {children}
      </h2>
    );
  }
  return (
    <h1 ref={headingRef} tabIndex={-1} className={className} data-testid={testId}>
      {children}
    </h1>
  );
}
