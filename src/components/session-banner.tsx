"use client";

import { Button } from "@/components/ui/button";
import { getEnableStatus, restoreSessionOnLoad } from "@/services/link/session";
import { KeyStore } from "@/services/KeyStore";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { sessionStatusLabel } from "@/lib/session-ui";

export function SessionBanner() {
  const status = useSessionStatusStore((s) => s.status);
  const setFromRestore = useSessionStatusStore((s) => s.setFromRestore);

  if (status.kind !== "session-offline" && status.kind !== "unknown") {
    return null;
  }

  return (
    <div
      role="status"
      className="border-b border-border bg-card px-6 py-3 text-sm"
      data-testid="sessionBanner"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
        <p>{sessionStatusLabel(status)}</p>
        {status.kind === "session-offline" ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void (async () => {
                const restore = await restoreSessionOnLoad();
                let enable;
                try {
                  enable = await getEnableStatus();
                } catch {
                  enable = undefined;
                }
                const pubky = (await KeyStore.getPubky()) ?? useAuthStore.getState().pubky;
                setFromRestore(restore, enable, { hasIdentity: Boolean(pubky) });
              })();
            }}
          >
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
