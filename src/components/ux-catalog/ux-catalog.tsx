"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AttachmentBubble } from "@/components/attachment-bubble";
import { AuthQr } from "@/components/auth-qr";
import { ChannelsPage, type ChannelsPageFixture } from "@/components/channels-page";
import { ChatsPage, CHATS_EMPTY_STATE_CANDIDATE_HINT, type ChatsPageRow } from "@/components/chats-page";
import { Composer } from "@/components/composer";
import { ContactDetail, type ContactDetailFixture } from "@/components/contact-detail";
import { ContactsPage, type ContactsPageFixture } from "@/components/contacts-page";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { EnablePage } from "@/components/enable-page";
import { ProfilePage } from "@/components/profile-page";
import { RequestsPage, type RequestsPageFixture } from "@/components/requests-page";
import { RingCallbackPage, type RingCallbackPhase } from "@/components/ring-callback-page";
import { SessionBanner } from "@/components/session-banner";
import { SettingsPage, type SettingsPageFixture } from "@/components/settings-page";
import { SignOutConfirm } from "@/components/sign-out-confirm";
import { SiteNav } from "@/components/site-nav";
import { TabLockBanner } from "@/components/tab-lock-banner";
import { ThreadView } from "@/components/thread-view";
import { WelcomePage } from "@/components/welcome-page";
import { buildAttachmentLocation, CHAT_ATTACHMENT_KIND, type AttachmentRecord } from "@/types/attachment";
import type { Contact } from "@/types";
import { CHAT_MESSAGE_KIND, buildDmConversationId, type LinkMessage, type LinkRecord } from "@/types/link";
import { GROUP_MESSAGE_KIND, type GroupChannel, type GroupMember, type GroupMessage } from "@/types/group";
import type { InboxRow } from "@/lib/inbox";
import type { NexusHotTag, NexusPublicPost } from "@/services/nexus/NexusDiscoveryClient";
import { useAuthStore } from "@/stores/authStore";
import { useInboxStore } from "@/stores/inboxStore";
import { useSessionStatusStore, type SessionUiStatus } from "@/stores/sessionStatusStore";
import { findUxCatalogScene, UX_CATALOG_SCENES, type UxCatalogScene } from "./scenes";

const OWNER = "ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u";
const ASTER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const BRAMBLE = "dynd4tffjtzbnhzqoy7c6xijp7kgfhaqdynd4tffjtzbnhzqoy7c";
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);
const DM_ID = buildDmConversationId(ASTER);
const CHANNEL_ID = `${OWNER}:22222222-2222-4222-8222-222222222222`;
const noop = () => undefined;
const asyncNoop = async () => undefined;

function SceneChrome({ scene }: { scene: UxCatalogScene }) {
  return (
    <header className="mb-6 border-b border-border pb-4">
      <p className="text-sm text-muted-foreground">Hypercolor UX catalog</p>
      <h1 className="text-2xl font-semibold tracking-tight">{scene.surface}</h1>
      <p className="text-sm text-muted-foreground">{scene.journey} · {scene.state}</p>
      <p className="mt-2 text-sm text-muted-foreground">{scene.id}</p>
    </header>
  );
}

function message(partial: Partial<LinkMessage>): LinkMessage {
  const base: LinkMessage = {
    ownerPubky: OWNER,
    eventId: "11111111-1111-4111-8111-111111111111",
    conversationId: DM_ID,
    peerPubky: ASTER,
    senderPubky: ASTER,
    direction: "received",
    kind: CHAT_MESSAGE_KIND,
    rawJson: "{}",
    body: "Can you review this color pass?",
    sentAt: NOW,
    receivedAt: NOW,
    deliveryState: "delivered",
  };
  return { ...base, ...partial };
}

function groupMessage(partial: Partial<GroupMessage>): GroupMessage {
  const base: GroupMessage = {
    ownerPubky: OWNER,
    channelId: `${OWNER}:22222222-2222-4222-8222-222222222222`,
    eventId: "33333333-3333-4333-8333-333333333333",
    senderPubky: ASTER,
    kind: GROUP_MESSAGE_KIND,
    body: "Design review is ready.",
    rawJson: "{}",
    sentAt: NOW,
    receivedAt: NOW,
    deliveryState: "delivered",
    replyToEventId: null,
    replyToAuthorPubky: null,
    targetEventId: null,
    targetAuthorPubky: null,
    editedAt: null,
    deleted: false,
  };
  return { ...base, ...partial };
}

function attachment(partial: Partial<AttachmentRecord>): AttachmentRecord {
  const eventId = "44444444-4444-4444-8444-444444444444";
  const base: AttachmentRecord = {
    ownerPubky: OWNER,
    eventId,
    conversationId: DM_ID,
    channelId: null,
    senderPubky: ASTER,
    direction: "received",
    location: buildAttachmentLocation(ASTER, eventId),
    keyRef: "__keystore__",
    contentType: "image/png",
    size: 4096,
    thumbnailLocation: null,
    localCachePath: null,
    createdAt: NOW,
    updatedAt: NOW,
    deliveryState: "delivered",
    resolveState: "ready",
  };
  return { ...base, ...partial };
}

function rows(): ChatsPageRow[] {
  return [
    { key: ASTER, href: `/chats/${encodeURIComponent(DM_ID)}`, title: "Aster Example", kind: "dm", preview: "See you in the thread", lastMessageAt: NOW, unreadCount: 3 },
    { key: BRAMBLE, href: `/chats/${encodeURIComponent(buildDmConversationId(BRAMBLE))}`, title: "Bramble Example", kind: "dm", preview: "Queued", lastMessageAt: NOW - 60_000, unreadCount: 0 },
    { key: `${ASTER.slice(0, 48)}aaaa`, href: "/chats/dm:fixture-alpha", title: "Cedar Example", kind: "dm", preview: "Attachment ready", lastMessageAt: NOW - 120_000, unreadCount: 1 },
    { key: `${ASTER.slice(0, 48)}bbbb`, href: "/chats/dm:fixture-beta", title: "Dahlia Example", kind: "dm", preview: "Payment request", lastMessageAt: NOW - 180_000, unreadCount: 0 },
    { key: `${ASTER.slice(0, 48)}cccc`, href: "/chats/dm:fixture-gamma", title: "Elm Example", kind: "dm", preview: "Encrypted Link established", lastMessageAt: NOW - 240_000, unreadCount: 0 },
  ];
}

function contact(partial: Partial<Contact> = {}): Contact {
  return {
    ownerPubky: OWNER,
    pubky: ASTER,
    displayName: "Aster Example",
    trustScore: 0.72,
    isFollowing: true,
    isFollower: true,
    isMutual: true,
    addedManually: true,
    firstSeenAt: NOW - 86_400_000,
    lastInteractionAt: NOW - 3_600_000,
    ...partial,
  };
}

function link(partial: Partial<LinkRecord> = {}): LinkRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: ASTER,
    role: "initiator",
    status: "established",
    snapshot: "__fixture_ciphertext__",
    remoteNoisePublicKey: "fixture-remote-noise-key",
    localReceiverPath: "hypercolor/wallet",
    remoteReceiverPath: "hypercolor/wallet",
    consecutiveFailures: 0,
    updatedAt: NOW,
    ...partial,
  };
}

function contactDetailFixture(state: string): ContactDetailFixture {
  if (state === "not-found") {
    return { contact: null, link: null, trust: { score: 0, reasons: [] }, loading: false };
  }
  return {
    contact: contact(),
    link: link(),
    trust: {
      score: 0.724,
      reasons: [
        { code: "manual", label: "Added manually", contribution: 0.4 },
        { code: "mutual", label: "Mutual follow", contribution: 0.324 },
      ],
    },
    loading: false,
  };
}

function contactsFixture(state: string): ContactsPageFixture {
  const populated = state === "populated" || state === "search-results";
  return {
    ownerPubky: OWNER,
    selected: null,
    contacts: populated
      ? [contact(), contact({ pubky: BRAMBLE, displayName: "Bramble Example", isFollower: true, isFollowing: false, isMutual: false })]
      : state === "follows-consent"
        ? [contact({ addedManually: false, lastInteractionAt: undefined })]
        : [],
    draft: state === "search-results" ? "aster" : "",
    busy: false,
    searchBusy: false,
    error: null,
    hits: state === "search-results"
      ? [{ pubky: ASTER, name: "Aster Example", bio: "Design reviewer", lookalike: false }]
      : null,
  };
}

function requestRows(groupInvite = false): RequestsPageFixture["rows"] {
  return [
    {
      request: {
        ownerPubky: OWNER,
        peerPubky: ASTER,
        createdAt: NOW - 120_000,
        updatedAt: NOW - 60_000,
        status: "pending",
      },
      contact: contact({ displayName: groupInvite ? "Group Host" : "Aster Example" }),
      invitations: groupInvite
        ? [{ channelId: CHANNEL_ID, name: "Design Review", founderPubky: ASTER }]
        : [],
    },
    ...(groupInvite
      ? []
      : [{
          request: {
            ownerPubky: OWNER,
            peerPubky: BRAMBLE,
            createdAt: NOW - 240_000,
            updatedAt: NOW - 120_000,
            status: "pending" as const,
          },
          contact: contact({ pubky: BRAMBLE, displayName: "Bramble Example" }),
          invitations: [],
        }]),
  ];
}

function requestsFixture(state: string): RequestsPageFixture {
  return {
    ownerPubky: OWNER,
    rows: state === "empty" ? [] : requestRows(state === "group-invite"),
    loaded: true,
    loadError: state === "error" ? "Could not load requests." : null,
    error: null,
    busyPeer: state === "busy" ? ASTER : null,
  };
}

function channelRow(partial: Partial<InboxRow> = {}): InboxRow {
  return {
    id: CHANNEL_ID,
    kind: "group",
    title: "Design Review",
    preview: "Private group message.",
    lastMessageAt: NOW - 45_000,
    unreadCount: 2,
    href: `/channels/${encodeURIComponent(CHANNEL_ID)}`,
    ...partial,
  };
}

function channel(partial: Partial<GroupChannel> = {}): GroupChannel {
  return {
    ownerPubky: OWNER,
    channelId: CHANNEL_ID,
    name: "Design Review",
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 45_000,
    createdBy: OWNER,
    isPublic: false,
    lastMessageAt: NOW - 45_000,
    membershipEpoch: 1,
    ...partial,
  };
}

function member(pubky: string, role: GroupMember["role"] = "member"): GroupMember {
  return {
    ownerPubky: OWNER,
    channelId: CHANNEL_ID,
    memberPubky: pubky,
    role,
    addedAt: NOW - 86_400_000,
    removedAt: null,
    status: "active",
  };
}

function channelFixture(state: string): ChannelsPageFixture["channelDetail"] {
  return {
    localPubky: OWNER,
    status: { kind: "enabled", pubky: OWNER },
    channel: channel(),
    messages: state === "empty" ? [] : [
      groupMessage({ channelId: CHANNEL_ID, body: "Private group message." }),
      groupMessage({ channelId: CHANNEL_ID, eventId: "44444444-4444-4444-8444-444444444444", senderPubky: OWNER, body: "Second production group bubble.", sentAt: NOW + 60_000 }),
      groupMessage({ channelId: CHANNEL_ID, eventId: "55555555-5555-4555-8555-555555555555", senderPubky: BRAMBLE, body: "Member reply with enough body text to make the populated state visibly different.", sentAt: NOW + 120_000 }),
    ],
    attachments: [],
    members: [member(OWNER, "admin"), member(ASTER), member(BRAMBLE)],
    contacts: [contact(), contact({ pubky: BRAMBLE, displayName: "Bramble Example" })],
    establishedPeers: [ASTER, BRAMBLE],
    draft: state === "editing" ? "Edited group message" : "",
    setDraft: noop,
    editingEventId: state === "editing" ? "33333333-3333-4333-8333-333333333333" : null,
    setEditingEventId: noop,
    sending: false,
    loading: state === "loading",
    error: state === "error" ? "Could not load channel." : null,
    isAdmin: state !== "members-non-admin",
    selfActive: state !== "composer-disabled",
    messagingEnabled: state !== "composer-disabled",
    reactions: [],
    send: asyncNoop,
    sendAttachment: asyncNoop,
    react: asyncNoop,
    removeMember: asyncNoop,
    addMember: asyncNoop,
    leave: asyncNoop,
    deleteMessage: asyncNoop,
    retryFailed: asyncNoop,
    reload: asyncNoop,
  };
}

function topics(): NexusHotTag[] {
  return [
    { label: "design", taggedCount: 14, taggersCount: 5 },
    { label: "wallets", taggedCount: 9, taggersCount: 3 },
  ];
}

function publicPost(partial: Partial<NexusPublicPost> = {}): NexusPublicPost {
  return {
    author: ASTER,
    postId: "pubky-note-1",
    content: "Public topic post from the index.",
    indexedAt: NOW - 90_000,
    kind: "short",
    ...partial,
  };
}

function publicPosts(): NexusPublicPost[] {
  return [
    publicPost(),
    publicPost({ author: BRAMBLE, postId: "pubky-note-2", content: "Second indexed post with a longer body for the populated topic.", indexedAt: NOW - 120_000 }),
    publicPost({ postId: "pubky-note-3", content: "Third indexed post keeps the public-topic populated capture distinct from empty.", indexedAt: NOW - 150_000 }),
  ];
}

function channelsFixture(scene: UxCatalogScene): ChannelsPageFixture {
  const isPublic = scene.surface === "public-topic" || scene.surface === "channels-public";
  const selectedTag = scene.surface === "public-topic" ? "design" : null;
  return {
    mode: isPublic ? "public" : "private",
    pathId: scene.surface === "channel" ? CHANNEL_ID : selectedTag,
    ownerPubky: OWNER,
    rows: scene.surface === "channels-private" && scene.state === "populated" ? [channelRow()] : [],
    eligible: [contact(), contact({ pubky: BRAMBLE, displayName: "Bramble Example" })],
    name: scene.state === "busy" ? "Design Review" : "",
    selected: {},
    busy: scene.state === "busy",
    error: scene.state === "error" ? "Could not create group." : null,
    loaded: true,
    loading: scene.state === "loading",
    storeError: scene.state === "error" ? "Could not load channels." : null,
    channelDetail: scene.surface === "channel" ? channelFixture(scene.state) : undefined,
    channelMembersOpen: scene.state === "members-open",
    publicTopics: {
      tags: scene.surface === "channels-public" && scene.state === "populated" ? topics() : [],
      loaded: scene.surface === "channels-public" && scene.state !== "initial",
      error: scene.state === "error" ? "Could not reach the public index." : null,
    },
    tagDetail: scene.surface === "public-topic"
      ? {
          posts: scene.state === "populated" ? publicPosts() : [],
          unavailable: scene.state === "unavailable" ? 1 : 0,
          loading: scene.state === "loading",
          error: scene.state === "error" ? "Could not reach the public index." : null,
          empty: scene.state === "empty",
        }
      : undefined,
  };
}

function ringPhase(state: string): RingCallbackPhase {
  if (state === "confirm") {
    return {
      kind: "confirm",
      pubky: OWNER,
      params: { pubky: OWNER, requestId: "00112233", mode: "secure_handoff", homeserver: OWNER },
      payload: {
        version: 1,
        pubky: OWNER,
        capabilities: [],
        noise_keypairs: [{ epoch: 1, public_key: "00", secret_key: "00" }],
        inbox_keypair: { public_key: "00", secret_key: "00" },
        expires_at: NOW + 300_000,
      },
    };
  }
  if (state === "done") return { kind: "done", pubky: OWNER };
  if (state === "error") return { kind: "error", fallback: "Could not complete this Ring handoff.", details: "Fixture failure" };
  if (state === "relay-forwarded") return { kind: "relay-forwarded" };
  return { kind: "reading" };
}

function settingsFixture(state: string): SettingsPageFixture {
  if (state === "recovery-gate") {
    return {
      recoveryCode: "alpha bravo charlie delta echo foxtrot golf hotel",
      confirmedSaved: false,
    };
  }
  if (state === "restore-success") {
    return {
      restoreNote: "Restore complete. History is local. Enable messaging again so links re-handshake.",
    };
  }
  if (state === "error") {
    return {
      backupError: "Could not create a backup.",
      restoreCode: "alpha bravo",
      restoreError: "That recovery code did not work.",
    };
  }
  return {};
}

function sessionStatusForScene(scene: UxCatalogScene): SessionUiStatus {
  if (scene.state === "no-identity" || scene.state === "not-connected") return { kind: "no-identity" };
  if (scene.state === "needs-enable" || scene.state === "disabled-composer") return { kind: "needs-enable" };
  if (scene.state === "offline") return { kind: "session-offline", pubky: OWNER };
  return { kind: "enabled", pubky: OWNER };
}

function authPanel(testID = "welcomeQr") {
  return (
    <div className="space-y-3">
      <AuthQr value="pubkyring://paykit-connect?request_id=vrt&caps=/pub/paykit/:rw" testID={testID} />
      <p className="break-all font-mono text-xs text-muted-foreground">
        pubkyring://paykit-connect?request_id=vrt
      </p>
    </div>
  );
}

function EnableCtaFixture() {
  return <EnableMessagingCta testId="uxCatalogEnableCta" />;
}

function ThreadFixture({ state }: { state: string }) {
  const messages =
    state === "empty"
      ? []
      : [
          message({ eventId: "11111111-1111-4111-8111-111111111111" }),
          message({ eventId: "22222222-2222-4222-8222-222222222222", senderPubky: OWNER, direction: "sent", body: "Looks good.", deliveryState: state === "failed-retry" ? "failed" : "sent", sentAt: NOW + 60_000 }),
          ...(state === "payment-notice" ? [message({ eventId: "55555555-5555-4555-8555-555555555555", kind: "paykit.payment_request.v0", body: "Payment request", sentAt: NOW + 120_000 })] : []),
          ...(state === "populated" ? [message({ eventId: "44444444-4444-4444-8444-444444444444", kind: CHAT_ATTACHMENT_KIND, body: "Attachment", sentAt: NOW + 180_000 })] : []),
        ];
  return (
    <ThreadView
      conversationId={DM_ID}
      participantPubky={ASTER}
      displayName="Aster Example"
      localPubky={OWNER}
      messages={messages}
      attachments={[attachment({ eventId: "44444444-4444-4444-8444-444444444444" })]}
      loading={state === "loading"}
      error={state === "error" ? "Thread unavailable." : null}
      draft={state === "sending" ? "Queued text" : ""}
      sending={state === "sending"}
      status={state === "disabled-composer" ? { kind: "needs-enable" } : { kind: "enabled", pubky: OWNER }}
      enableCta={<EnableCtaFixture />}
      renderAttachment={(record) => <AttachmentBubble record={record} />}
      onChangeDraft={noop}
      onSend={noop}
      onAttach={noop}
      onRetry={noop}
      onResolved={noop}
    />
  );
}

function ChatsFixture({ state }: { state: string }) {
  return (
    <ChatsPage
      conversationId={null}
      enableCta={<EnableCtaFixture />}
      thread={<ThreadView conversationId={null} participantPubky={null} localPubky={OWNER} messages={[]} attachments={[]} loading={false} error={null} draft="" sending={false} status={{ kind: "enabled", pubky: OWNER }} enableCta={null} renderAttachment={() => null} onChangeDraft={noop} onSend={noop} onAttach={noop} onRetry={noop} onResolved={noop} />}
      rows={state === "populated" || state === "error" ? rows() : []}
      pendingRequests={state === "populated" ? 2 : 0}
      inboxError={state === "error" ? "Could not load inbox." : null}
      inboxLoading={state === "loading"}
      onRetryInbox={noop}
      peerDraft={state === "starting" ? ASTER : ""}
      starting={state === "starting"}
      startError={state === "start-error" ? "Peer not reachable." : null}
      status={state === "empty-enable" ? { kind: "needs-enable" } : { kind: "enabled", pubky: OWNER }}
      onChangePeerDraft={noop}
      onStartChat={noop}
      emptyStateHint={state === "empty-candidate" ? CHATS_EMPTY_STATE_CANDIDATE_HINT : undefined}
    />
  );
}

function ComposerMenuFixture() {
  return (
    <section data-surface="composer-menu" className="space-y-4">
      <Composer
        draft="Fixture text"
        sending={false}
        placeholder="Message"
        onChangeDraft={noop}
        onSend={noop}
        onAttach={noop}
        testIdPrefix="uxCatalogComposer"
        initialMenuOpen
      />
    </section>
  );
}

function SurfaceShell({ surface, children }: { surface: string; children: ReactNode }) {
  return <section data-surface={surface} className="space-y-4">{children}</section>;
}

function RenderProductionScene({ scene }: { scene: UxCatalogScene }) {
  if (scene.id.startsWith("chrome-nav")) {
    const pending = scene.state === "enabled" ? 3 : scene.state === "needs-enable" ? 1 : 0;
    return <SiteNav fixturePathname="/chats" fixtureStatus={sessionStatusForScene(scene)} fixturePendingRequests={pending} />;
  }
  if (scene.id === "chrome-session-offline") return <SessionBanner fixtureStatus={{ kind: "session-offline", pubky: OWNER }} />;
  if (scene.id === "chrome-tab-lock") return <TabLockBanner fixtureLock={{ mode: "readonly", requestTakeover: noop }} />;
  if (scene.surface === "welcome") {
    return (
      <WelcomePage
        appName="Hypercolor"
        isAuthenticated={scene.state === "authenticated"}
        pubky={scene.state === "authenticated" ? OWNER : null}
        isLoading={scene.state === "loading"}
        isExpired={scene.state === "expired"}
        error={scene.state === "error" ? "Handoff failed." : null}
        pendingPubky={scene.state === "adopt-confirm" ? ASTER : null}
        adopting={false}
        authPanel={scene.state === "qr-populated" ? authPanel("welcomeQr") : null}
        linkLive={scene.state === "qr-populated"}
        onGenerateLink={noop}
        onConfirmAdoption={noop}
        onCancelAdoption={noop}
        onCancelWaiting={noop}
      />
    );
  }
  if (scene.surface === "enable") {
    return (
      <EnablePage
        enabled={scene.state === "enabled"}
        offline={scene.state === "offline"}
        isLoading={scene.state === "checking"}
        isExpired={scene.state === "expired"}
        denied={scene.state === "denied"}
        error={scene.state === "error" ? "Grant failed." : null}
        identityLabel={OWNER}
        provisionedPath={scene.state === "enabled" ? "hypercolor/wallet" : null}
        authPanel={scene.state === "waiting-qr" ? authPanel("enableMessagingQr") : null}
        onRegenerate={noop}
        onRetry={noop}
        onOpenChats={noop}
        onDone={noop}
        onNotNow={noop}
        onCancel={noop}
      />
    );
  }
  if (scene.surface.includes("chats-list")) return <ChatsFixture state={scene.state} />;
  if (scene.surface === "thread") return <ThreadFixture state={scene.state} />;
  if (scene.surface === "requests") return <RequestsPage fixture={requestsFixture(scene.state)} />;
  if (scene.surface.startsWith("channels") || scene.surface === "channel" || scene.surface === "public-topic") {
    return <ChannelsPage fixture={channelsFixture(scene)} />;
  }
  if (scene.surface === "contacts") return <ContactsPage fixture={contactsFixture(scene.state)} />;
  if (scene.surface === "contact-detail") return <ContactDetail ownerPubky={OWNER} pubky={ASTER} fixture={contactDetailFixture(scene.state)} />;
  if (scene.surface === "profile") return <ProfilePage />;
  if (scene.surface === "sign-out") {
    return (
      <SurfaceShell surface="sign-out-confirm">
        <SignOutConfirm triggerTestId="profileSignOut" busy={false} initialOpen onSignOut={noop} />
      </SurfaceShell>
    );
  }
  if (scene.surface === "settings") return <SettingsPage fixture={settingsFixture(scene.state)} />;
  if (scene.surface === "ring-callback") return <RingCallbackPage fixturePhase={ringPhase(scene.state)} />;
  if (scene.surface === "composer-menu") return <ComposerMenuFixture />;
  if (scene.surface === "attachment") return <AttachmentBubble record={attachment({ deliveryState: scene.state === "failed" ? "failed" : "delivered", resolveState: scene.state === "unavailable" ? "unavailable-from-backup" : "ready" })} />;
  return <SurfaceShell surface={scene.surface}>Unknown catalog surface: {scene.id}</SurfaceShell>;
}

function installFixtureStores(scene: UxCatalogScene) {
  let status: SessionUiStatus = { kind: "enabled", pubky: OWNER };
  if (scene.state === "no-identity" || scene.state === "not-connected") status = { kind: "no-identity" };
  if (scene.state === "needs-enable" || scene.state === "disabled-composer") status = { kind: "needs-enable" };
  if (scene.state === "offline") status = { kind: "session-offline", pubky: OWNER };
  useSessionStatusStore.setState({ status });
  if (status.kind === "no-identity") {
    useAuthStore.getState().clearSession();
  } else {
    useAuthStore.getState().setAuthenticated(OWNER, "homeserver.staging.pubky.app");
    useAuthStore.getState().setProfile({ pubky: OWNER, displayName: "Aster Example", updatedAt: NOW });
  }
  useInboxStore.getState().setRows([], scene.id.includes("requests") ? 2 : 0);
}

export function UxCatalog() {
  const searchParams = useSearchParams();
  const sceneId = searchParams.get("scene");
  const scene = findUxCatalogScene(sceneId);
  installFixtureStores(scene);
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = () => Promise.reject(new Error("UX catalog blocks network"));
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return (
    <div className="space-y-6">
      <SceneChrome scene={scene} />
      <div data-vrt-scene={scene.id}>
        <div data-vrt-portal-root className="fixed inset-0" />
        <RenderProductionScene scene={scene} />
      </div>
      <details className="text-sm text-muted-foreground">
        <summary>Catalog scenes</summary>
        <ul className="mt-2 columns-1 md:columns-2">
          {UX_CATALOG_SCENES.map((item) => (
            <li key={item.id}>
              <a href={`/e2e/ux-catalog?scene=${item.id}`}>{item.id}</a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
