import { notFound } from "next/navigation";
import { isE2eHarnessEnabled } from "@/lib/e2e-harness";

export function requireE2eHarness(): void {
  if (!isE2eHarnessEnabled()) notFound();
}
