"use client";

import { AuthQr } from "@/components/auth-qr";
import { AppShell } from "@/components/shell/app-shell";
import { CompactListRow } from "@/components/shell/compact-list-row";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FilterHeader,
  FilterItem,
  FilterItemLabel,
  FilterList,
  FilterRoot,
} from "@/components/ui/filter";
import { Heading } from "@/components/ui/heading";
import { IconHash, IconMessageCircle, IconSearch, IconUsers } from "@/components/ui/icons";
import { IllustratedEmptyState } from "@/components/ui/illustrated-empty-state";
import { InputField } from "@/components/ui/input-field";
import { PageHeader, PageSubtitle } from "@/components/ui/page-header";
import { PopoverPublicKey } from "@/components/ui/popover-public-key";
import { SidebarButton } from "@/components/ui/sidebar-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import { Typography } from "@/components/ui/typography";
import { formatClock } from "@/lib/format";
import { formatPublicKey } from "@/lib/formatPublicKey";
import {
  CHANNELS,
  CHATS,
  CONNECT,
  CONTACTS,
  REQUESTS,
  SELF,
  THREAD,
  WELCOME,
} from "@/design/fixtures";

function Bubble({ mine, body, sentAt }: { mine: boolean; body: string; sentAt: number }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`hc-bubble space-y-1 ${mine ? "hc-bubble-mine" : "hc-bubble-theirs"}`}>
        <p className="whitespace-pre-wrap break-words">{body}</p>
        <p className={`hc-meta ${mine ? "hc-on-brand-muted" : "text-muted-foreground"}`}>
          {formatClock(sentAt)}
          {mine ? " · sent" : ""}
        </p>
      </div>
    </div>
  );
}

export function WelcomeScreen() {
  return (
    <AppShell title="Hypercolor" active="home" selfPubky={SELF.pubky} hideChrome>
      <section className="overflow-hidden rounded-xl hc-hero-iridescent p-[2px]">
        <div className="rounded-[10px] bg-background p-8">
          <PageHeader>
            <Heading size="xl">Connect with Pubky Ring</Heading>
            <PageSubtitle>Scan the QR, then confirm the verification code on both devices.</PageSubtitle>
          </PageHeader>
          <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start">
            <AuthQr value={WELCOME.authUrl} />
            <div className="space-y-4">
              <Typography size="sm" className="text-muted-foreground">
                Verification code
              </Typography>
              <p className="text-4xl font-bold tracking-[0.3em] text-brandMuted">{WELCOME.verification}</p>
              <div className="rounded-full bg-brand-2 px-4 py-2 text-sm font-semibold text-on-teal">
                Bright teal accent — dark ink on teal
              </div>
              <Button variant="brand">Open in Ring</Button>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

export function ChatsScreen() {
  return (
    <AppShell
      title="Chats"
      active="chats"
      selfPubky={SELF.pubky}
      leftRail={
        <FilterRoot>
          <FilterHeader title="Inbox" subtitle="Direct" />
          <FilterList>
            <FilterItem isSelected>
              <FilterItemLabel>All</FilterItemLabel>
            </FilterItem>
            <FilterItem>
              <FilterItemLabel>Unread</FilterItemLabel>
            </FilterItem>
          </FilterList>
        </FilterRoot>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(16rem,20rem)_1fr]">
        <Card className="py-4">
          <CardHeader>
            <CardTitle>Threads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {CHATS.map((chat) => (
              <div key={chat.id} className="rounded-lg border border-border px-2">
                <CompactListRow name={chat.peer.name} pubky={chat.peer.pubky} subtitle={chat.preview} time={chat.sentAt} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="flex min-h-[28rem] flex-col py-4">
          <CardHeader className="flex-row items-center gap-2">
            <Avatar seed={CONTACTS[0].pubky} size="md" ring />
            <div>
              <CardTitle>{CONTACTS[0].name}</CardTitle>
              <PopoverPublicKey pubky={CONTACTS[0].pubky} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            {THREAD.map((m) => (
              <Bubble key={m.id} mine={m.mine} body={m.body} sentAt={m.sentAt} />
            ))}
            <div className="mt-auto flex gap-2">
              <Textarea defaultValue="" placeholder="Message Satoshi" className="min-h-12" />
              <Button variant="brand" className="self-end">
                Send
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

export function ContactsScreen() {
  const selected = CONTACTS[0];
  return (
    <AppShell title="Contacts" active="contacts" selfPubky={SELF.pubky}>
      <div className="grid gap-6 lg:grid-cols-[minmax(16rem,20rem)_1fr]">
        <Card className="py-4">
          <CardContent>
            <InputField placeholder="Search" defaultValue="" icon={<IconSearch className="size-4 text-muted-foreground" />} />
            <div className="mt-4 space-y-1">
              {CONTACTS.map((c, i) => (
                <div key={c.pubky} className={i === 0 ? "rounded-lg bg-white/5 px-2" : "px-2"}>
                  <CompactListRow name={c.name} pubky={c.pubky} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="items-center text-center">
            <Avatar seed={selected.pubky} size="xl" ring />
            <CardTitle className="mt-3">{selected.name}</CardTitle>
            <p className="text-xs font-medium tracking-[1.2px] text-muted-foreground uppercase">
              {formatPublicKey({ key: selected.pubky })}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Typography>{selected.bio}</Typography>
            <div className="flex gap-2">
              <Button variant="brand">Message</Button>
              <Button variant="outline">Pay</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

export function ChannelsScreen() {
  return (
    <AppShell
      title="Channels"
      active="channels"
      selfPubky={SELF.pubky}
      rightRail={
        <div className="space-y-2">
          <SidebarButton icon={IconHash}>New channel</SidebarButton>
        </div>
      }
    >
      <PageHeader>
        <Heading>Public channels</Heading>
        <PageSubtitle>Topics replicated from the homeserver.</PageSubtitle>
      </PageHeader>
      <div className="space-y-2">
        {CHANNELS.map((ch) => (
          <Card key={ch.id} className="py-4">
            <CardContent className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-brand/16 text-brand">
                <IconHash className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{ch.title}</p>
                <p className="text-xs text-muted-foreground">{ch.topic}</p>
              </div>
              {ch.unread ? <Badge>{ch.unread}</Badge> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

export function RequestsScreen() {
  return (
    <AppShell title="Requests" active="requests" selfPubky={SELF.pubky}>
      <PageHeader>
        <Heading>Inbound requests</Heading>
        <PageSubtitle>Accept to open an encrypted link.</PageSubtitle>
      </PageHeader>
      <div className="space-y-3">
        {REQUESTS.map((req) => (
          <Card key={req.pubky} className="py-4">
            <CardContent className="flex flex-wrap items-center gap-3">
              <CompactListRow name={req.name} pubky={req.pubky} />
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="brand">
                  Accept
                </Button>
                <Button size="sm" variant="destructive">
                  Decline
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

export function SettingsScreen() {
  return (
    <AppShell title="Settings" active="settings" selfPubky={SELF.pubky}>
      <PageHeader>
        <Heading>Account</Heading>
        <PageSubtitle>Signed in as {SELF.name}</PageSubtitle>
      </PageHeader>
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar seed={SELF.pubky} size="lg" ring />
            <div>
              <p className="text-sm font-bold">{SELF.name}</p>
              <PopoverPublicKey pubky={SELF.pubky} />
            </div>
          </div>
          <Skeleton className="h-4 w-2/3" />
          <Toast title="Backup reminder" description="Export recovery material before you sign out." />
          <Button variant="outline">Sign out</Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}

export function ConnectScreen() {
  return (
    <AppShell title="Connect" active="home" selfPubky={SELF.pubky} hideChrome>
      <Card className="mx-auto max-w-lg sm:rounded-xl sm:p-2">
        <CardHeader>
          <CardTitle>Continue as {CONNECT.displayName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar seed={CONNECT.pubky} size="lg" ring />
            <p className="text-xs font-medium tracking-[1.2px] text-muted-foreground uppercase">
              {formatPublicKey({ key: CONNECT.pubky })}
            </p>
          </div>
          <Typography size="sm" className="text-muted-foreground">
            This session requests both scopes in one confirm:
          </Typography>
          <ul className="space-y-3">
            {CONNECT.scopes.map((scope) => (
              <li key={scope.id} className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm font-bold">{scope.label}</p>
                <p className="text-sm text-muted-foreground">{scope.detail}</p>
              </li>
            ))}
          </ul>
          <Button variant="brand" className="w-full">
            Continue
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}

export function EmptyScreen() {
  return (
    <AppShell title="Empty" active="chats" selfPubky={SELF.pubky}>
      <div className="grid gap-8 lg:grid-cols-3">
        <IllustratedEmptyState
          icon={IconMessageCircle}
          title="No chats yet"
          subtitle="Start a thread from a contact or a Ring invite."
        />
        <IllustratedEmptyState
          icon={IconUsers}
          title="No contacts"
          subtitle="Follow someone on Pubky, then they appear here."
        />
        <IllustratedEmptyState
          icon={IconHash}
          title="No channels"
          subtitle="Join a public topic to fill this list."
        />
      </div>
    </AppShell>
  );
}

export const DESIGN_SCREENS = [
  { id: "welcome", Screen: WelcomeScreen },
  { id: "chats", Screen: ChatsScreen },
  { id: "contacts", Screen: ContactsScreen },
  { id: "channels", Screen: ChannelsScreen },
  { id: "requests", Screen: RequestsScreen },
  { id: "settings", Screen: SettingsScreen },
  { id: "connect", Screen: ConnectScreen },
  { id: "empty", Screen: EmptyScreen },
] as const;

export type DesignSurfaceId = (typeof DESIGN_SCREENS)[number]["id"];
