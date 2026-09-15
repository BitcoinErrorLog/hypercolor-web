"use client";

import { useSearchParams } from "next/navigation";

export function useQueryParam(key: string): string | null {
  const params = useSearchParams();
  return params.get(key);
}

