"use client";

import Link from "next/link";
import { TruncatedPubky } from "@/components/truncated-pubky";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader, PageSubtitle } from "@/components/ui/page-header";
import { SignOutConfirm } from "@/components/sign-out-confirm";
import { useSignOut } from "@/hooks/useSignOut";
import { sanitizeDisplayName } from "@/lib/display-name";
import { CUSTODY_LINE, sessionStatusLabel } from "@/lib/session-ui";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

export function ProfilePage() {
  const pubky = useAuthStore((s) => s.pubky);
  const profile = useAuthStore((s) => s.profile);
  const status = useSessionStatusStore((s) => s.status);
  const { signOut, busy } = useSignOut();

  return (
    <article className="space-y-6" data-testid="profileScreen" data-surface="profile-page">
      <PageHeader>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <PageSubtitle>{sessionStatusLabel(status)}</PageSubtitle>
      </PageHeader>
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="flex h-20 w-20 items-center justify-center" data-testid="profileAvatarInitial">
          <Avatar seed={pubky ?? profile?.displayName ?? "anon"} size="xl" ring />
        </div>
        <p className="text-lg font-medium">
          {profile?.displayName ? sanitizeDisplayName(profile.displayName) : "Unnamed"}
        </p>
        {pubky ? (
          <TruncatedPubky pubky={pubky} testId="profilePubky" full />
        ) : (
          <p className="text-sm text-muted-foreground">Not connected</p>
        )}
        <p className="text-sm text-muted-foreground">{CUSTODY_LINE}</p>
        <p className="text-sm text-muted-foreground">{sessionStatusLabel(status)}</p>
      </div>

      <EnableMessagingCta testId="profileEnableMessaging" />

      <nav className="space-y-1" aria-label="Account">
        <Link
          href="/settings"
          className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm hover:bg-accent/40"
        >
          Settings
        </Link>
        <Link
          href="/requests"
          className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm hover:bg-accent/40"
        >
          Message requests
        </Link>
      </nav>

      <SignOutConfirm
        triggerTestId="profileSignOut"
        busy={busy}
        onSignOut={() => signOut()}
      />
    </article>
  );
}
