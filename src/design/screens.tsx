"use client";

import { AuthQr } from "@/components/auth-qr";
import { AppShell } from "@/components/shell/app-shell";
import { CompactListRow } from "@/components/shell/compact-list-row";
import { MasterDetail } from "@/components/shell/master-detail";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import { Typography } from "@/components/ui/typography";
import { formatClock } from "@/lib/format";
import { formatPublicKey } from "@/lib/formatPublicKey";
import {
  CHANNELS,
  CHANNEL_THREAD,
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
      <div className={`hc-bubble space-y-1 text-base leading-6 ${mine ? "hc-bubble-mine" : "hc-bubble-theirs"}`}>
        <p className="whitespace-pre-wrap break-words">{body}</p>
        <p className={`text-xs ${mine ? "hc-on-brand-muted" : "text-muted-foreground"}`}>
          {formatClock(sentAt)}
          {mine ? " · sent" : ""}
        </p>
      </div>
    </div>
  );
}

function ThreadPane({
  name,
  pubky,
  messages,
}: {
  name: string;
  pubky: string;
  messages: readonly { id: string; mine: boolean; body: string; sentAt: number }[];
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Avatar seed={pubky} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{name}</p>
          <PopoverPublicKey pubky={pubky} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <Bubble key={m.id} mine={m.mine} body={m.body} sentAt={m.sentAt} />
        ))}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-border px-4 py-3">
        <Textarea defaultValue="" placeholder={`Message ${name}`} className="min-h-12 min-w-0 flex-1 text-base" />
        <Button variant="brand" className="self-end">
          Send
        </Button>
      </div>
    </div>
  );
}

export function WelcomeScreen() {
  return (
    <AppShell title="Hypercolor" active="home" selfPubky={SELF.pubky} hideChrome>
      <section className="hc-hero-iridescent w-full max-w-3xl min-h-[60svh] rounded-xl p-[2px]">
        <div className="flex min-h-[60svh] min-w-0 flex-col justify-center gap-8 rounded-[10px] bg-background p-8 lg:flex-row lg:items-center">
          <AuthQr value={WELCOME.authUrl} />
          <div className="min-w-0 flex-1 space-y-4">
            <Heading size="lg">Connect with Pubky Ring</Heading>
            <Typography className="text-base">
              Scan the QR, then confirm the verification code on both devices.
            </Typography>
            <p className="text-4xl font-bold tracking-wide text-brand-2">{WELCOME.verification}</p>
            <Button variant="brand" className="lg:hidden">
              Open in Pubky Ring
            </Button>
            <Typography className="hidden text-base text-muted-foreground lg:block">
              Scan with Pubky Ring on your phone
            </Typography>
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
      fillViewport
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
      <PageHeader className="shrink-0">
        <Heading size="lg">Chats</Heading>
        <PageSubtitle>Encrypted threads on this device.</PageSubtitle>
      </PageHeader>
      <MasterDetail
        list={
          <div className="px-2 py-2">
            {CHATS.map((chat, i) => (
              <div key={chat.id} className={i === 0 ? "rounded-lg bg-white/5 px-2" : "px-2"}>
                <CompactListRow
                  name={chat.peer.name}
                  pubky={chat.peer.pubky}
                  subtitle={chat.preview}
                  time={chat.sentAt}
                />
              </div>
            ))}
          </div>
        }
        detail={<ThreadPane name={CONTACTS[0].name} pubky={CONTACTS[0].pubky} messages={THREAD} />}
      />
    </AppShell>
  );
}

export function ContactsScreen() {
  const selected = CONTACTS[0];
  return (
    <AppShell title="Contacts" active="contacts" selfPubky={SELF.pubky} fillViewport>
      <PageHeader className="shrink-0">
        <Heading size="lg">Contacts</Heading>
        <PageSubtitle>People you have an encrypted link with.</PageSubtitle>
      </PageHeader>
      <MasterDetail
        list={
          <div className="px-3 py-3">
            <InputField placeholder="Search" defaultValue="" icon={<IconSearch className="size-4 text-muted-foreground" />} />
            <div className="mt-4 space-y-1">
              {CONTACTS.map((c, i) => (
                <div key={c.pubky} className={i === 0 ? "rounded-lg bg-white/5 px-2" : "px-2"}>
                  <CompactListRow name={c.name} pubky={c.pubky} />
                </div>
              ))}
            </div>
          </div>
        }
        detail={
          <div className="flex h-full w-full min-w-0 flex-1 flex-col items-stretch justify-center gap-4 self-stretch px-6 py-6">
            <Avatar seed={selected.pubky} size="xl" />
            <Heading size="lg">{selected.name}</Heading>
            <p className="w-full min-w-0 text-xs font-medium tracking-[1.2px] text-muted-foreground uppercase">
              {formatPublicKey({ key: selected.pubky })}
            </p>
            <p className="w-full min-w-0 text-base leading-6">{selected.bio}</p>
            <div className="flex w-full min-w-0 flex-wrap gap-2">
              <Button variant="brand">Message</Button>
              <Button variant="outline">Pay</Button>
            </div>
          </div>
        }
      />
    </AppShell>
  );
}

export function ChannelsScreen() {
  return (
    <AppShell
      title="Channels"
      active="channels"
      selfPubky={SELF.pubky}
      fillViewport
      rightRail={
        <div className="space-y-2">
          <SidebarButton icon={IconHash}>New channel</SidebarButton>
        </div>
      }
    >
      <PageHeader className="shrink-0">
        <Heading size="lg">Channels</Heading>
        <PageSubtitle>Public topics from the homeserver.</PageSubtitle>
      </PageHeader>
      <MasterDetail
        list={
          <div className="py-2">
            {CHANNELS.map((ch, i) => (
              <div
                key={ch.id}
                className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? "bg-white/5" : ""}`}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/16 text-brand">
                  <IconHash className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{ch.title}</p>
                  <p className="truncate text-base text-muted-foreground">{ch.topic}</p>
                </div>
                {ch.unread ? <Badge>{ch.unread}</Badge> : null}
              </div>
            ))}
          </div>
        }
        detail={
          <ThreadPane
            name={CHANNELS[0].title}
            pubky={CONTACTS[1].pubky}
            messages={CHANNEL_THREAD.map((m) => ({ id: m.id, mine: m.mine, body: m.body, sentAt: m.sentAt }))}
          />
        }
      />
    </AppShell>
  );
}

export function RequestsScreen() {
  const selected = REQUESTS[0];
  return (
    <AppShell title="Requests" active="requests" selfPubky={SELF.pubky} fillViewport>
      <PageHeader className="shrink-0">
        <Heading size="lg">Requests</Heading>
        <PageSubtitle>Accept to open an encrypted link.</PageSubtitle>
      </PageHeader>
      <MasterDetail
        list={
          <div className="py-2">
            {REQUESTS.map((req, i) => (
              <div key={req.pubky} className={i === 0 ? "bg-white/5 px-3" : "px-3"}>
                <CompactListRow name={req.name} pubky={req.pubky} subtitle={req.note} />
              </div>
            ))}
          </div>
        }
        detail={
          <div className="flex h-full w-full min-w-0 flex-1 flex-col items-stretch gap-4 overflow-y-auto px-6 py-6">
            <div className="flex w-full min-w-0 items-center gap-3">
              <Avatar seed={selected.pubky} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{selected.name}</p>
                <p className="truncate text-xs font-medium tracking-[1.2px] text-muted-foreground uppercase">
                  {formatPublicKey({ key: selected.pubky })}
                </p>
              </div>
            </div>
            <p className="w-full min-w-0 text-base leading-6">{selected.note}</p>
            <ul className="space-y-3">
              {selected.scopes.map((scope) => (
                <li key={scope.id} className="min-w-0 rounded-lg border border-border p-4">
                  <p className="text-sm font-bold">{scope.label}</p>
                  <p className="text-base text-muted-foreground">{scope.detail}</p>
                </li>
              ))}
            </ul>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button variant="brand">Accept</Button>
              <Button variant="destructive">Decline</Button>
            </div>
          </div>
        }
      />
    </AppShell>
  );
}

export function SettingsScreen() {
  return (
    <AppShell title="Settings" active="settings" selfPubky={SELF.pubky} fillViewport centerColumn>
      <div className="flex min-h-[calc(100svh-11rem)] w-full min-w-0 flex-col justify-center">
        <PageHeader>
          <Heading size="lg">Settings</Heading>
          <PageSubtitle>Signed in as {SELF.name}</PageSubtitle>
        </PageHeader>
        <div className="w-full min-w-0 space-y-6">
          <div className="flex items-center gap-3">
            <Avatar seed={SELF.pubky} size="lg" ring />
            <div className="min-w-0">
              <p className="text-sm font-bold">{SELF.name}</p>
              <PopoverPublicKey pubky={SELF.pubky} />
            </div>
          </div>
          <Toast title="Backup reminder" description="Export recovery material before you sign out." />
          <Button variant="outline">Sign out</Button>
        </div>
      </div>
    </AppShell>
  );
}

export function ConnectScreen() {
  return (
    <AppShell title="Connect" active="home" selfPubky={SELF.pubky} hideChrome>
      <div className="w-full min-w-0 max-w-3xl px-1">
        <PageHeader>
          <Heading size="lg">Continue as {CONNECT.displayName}</Heading>
          <p className="w-full min-w-0 text-base leading-6 text-muted-foreground">
            Hypercolor and Paykit will use this identity on this device.
          </p>
        </PageHeader>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar seed={CONNECT.pubky} size="lg" ring />
          <p className="min-w-0 text-xs font-medium tracking-[1.2px] text-muted-foreground uppercase">
            {formatPublicKey({ key: CONNECT.pubky })}
          </p>
        </div>
        <ul className="mt-6 space-y-3">
          {CONNECT.scopes.map((scope) => (
            <li key={scope.id} className="min-w-0 rounded-lg border border-border p-4">
              <p className="text-sm font-bold">{scope.label}</p>
              <p className="text-base leading-6 text-muted-foreground">{scope.detail}</p>
            </li>
          ))}
        </ul>
        <Button variant="brand" className="mt-6 w-full">
          Continue
        </Button>
      </div>
    </AppShell>
  );
}

export function EmptyScreen() {
  return (
    <AppShell title="Home" active="chats" selfPubky={SELF.pubky} fillViewport>
      <div className="flex min-h-full flex-1 flex-col justify-center">
        <PageHeader className="shrink-0">
          <Heading size="lg">Get started</Heading>
          <PageSubtitle>Your chats, contacts, and channels will land here.</PageSubtitle>
        </PageHeader>
        <div className="grid gap-6 pb-4 lg:grid-cols-3">
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
