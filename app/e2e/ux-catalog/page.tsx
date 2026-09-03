import { Suspense } from "react";
import { UxCatalog } from "@/components/ux-catalog/ux-catalog";
import { requireE2eHarness } from "@/lib/require-e2e-harness";

export default async function UxCatalogPage() {
  requireE2eHarness();
  return (
    <Suspense fallback={<p>Loading UX catalog…</p>}>
      <UxCatalog />
    </Suspense>
  );
}
