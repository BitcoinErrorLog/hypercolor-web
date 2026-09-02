"use client";

import { useRouter } from "next/navigation";
import { rememberListRow, type ListPane } from "@/lib/list-detail-focus";

export function DetailBackLink({
  href,
  listLabel,
  always = false,
}: {
  href: string;
  listLabel: string;
  always?: boolean;
}) {
  const router = useRouter();
  const label = `Back to ${listLabel}`;
  return (
    <button
      type="button"
      className={
        always
          ? "inline-flex min-h-11 min-w-11 items-center text-sm text-brand underline-offset-4 hover:underline"
          : "md:hidden inline-flex min-h-11 min-w-11 items-center text-sm text-brand underline-offset-4 hover:underline"
      }
      data-testid="detailBack"
      aria-label={label}
      onClick={() => {
        router.push(href);
      }}
    >
      {label}
    </button>
  );
}

export function rememberAndOpen(list: ListPane, rowId: string): void {
  rememberListRow(list, rowId);
}
