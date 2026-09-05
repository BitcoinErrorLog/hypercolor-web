"use client";

import type { ReactNode, Ref } from "react";
import { useTwoPane } from "@/hooks/useTwoPane";
import { detailHeadingTag } from "@/lib/list-detail-focus";

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
  if (detailHeadingTag(twoPane) === "h2") {
    return (
      <h2 ref={headingRef} tabIndex={-1} className={`${className} hc-programmatic-focus`} data-testid={testId}>
        {children}
      </h2>
    );
  }
  return (
    <h1 ref={headingRef} tabIndex={-1} className={`${className} hc-programmatic-focus`} data-testid={testId}>
      {children}
    </h1>
  );
}
