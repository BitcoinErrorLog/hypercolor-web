"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSignOut } from "@/hooks/useSignOut";
import { sanitizeDisplayName } from "@/lib/display-name";
import { sessionStatusLabel } from "@/lib/session-ui";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

export function ProfilePage() {
  const pubky = useAuthStore((s) => s.pubky);
  const profile = useAuthStore((s) => s.profile);
  const status = useSessionStatusStore((s) => s.status);
  const { signOut, busy } = useSignOut();

  return (
    <article className="space-y-6" data-testid="profileScreen">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <Link href="/settings" className="text-sm text-brand underline-offset-4 hover:underline">
          Settings
        </Link>
      </div>
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary text-2xl text-brand">
          {(profile?.displayName
            ? sanitizeDisplayName(profile.displayName)
            : pubky ?? "?"
          ).charAt(0).toUpperCase()}
        </div>
        <p className="text-lg font-medium">
          {profile?.displayName ? sanitizeDisplayName(profile.displayName) : "Unnamed"}
        </p>
        {pubky ? (
          <p className="break-all font-mono text-sm text-muted-foreground" data-testid="profilePubky">
            {pubky}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Not connected</p>
        )}
        <p className="text-sm text-muted-foreground">{sessionStatusLabel(status)}</p>
        <p className="text-xs text-muted-foreground">Keys managed by Pubky Ring</p>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        data-testid="profileSignOut"
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
    </article>
  );
}
