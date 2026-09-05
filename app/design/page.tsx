"use client";

import { useSearchParams } from "next/navigation";
import { DESIGN_SCREENS, type DesignSurfaceId } from "@/design/screens";

function isSurface(value: string | null): value is DesignSurfaceId {
  return DESIGN_SCREENS.some((s) => s.id === value);
}

export default function DesignPage() {
  const params = useSearchParams();
  const only = params.get("surface");
  const screens = isSurface(only) ? DESIGN_SCREENS.filter((s) => s.id === only) : DESIGN_SCREENS;

  return (
    <div className="min-h-screen bg-background">
      {screens.map(({ id, Screen }) => (
        <section key={id} data-surface={`design:${id}`} className="min-h-screen">
          <Screen />
        </section>
      ))}
    </div>
  );
}
