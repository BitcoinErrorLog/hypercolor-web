import { Suspense } from "react";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

const UxCatalog = dynamic(() =>
  __HYPERCOLOR_E2E_HARNESS__
    ? import("@/components/ux-catalog/ux-catalog").then((mod) => mod.UxCatalog)
    : Promise.resolve(() => null),
);

export default async function UxCatalogPage() {
  if (!__HYPERCOLOR_E2E_HARNESS__) notFound();
  return (
    <Suspense fallback={<p>Loading UX catalog…</p>}>
      <UxCatalog />
    </Suspense>
  );
}
