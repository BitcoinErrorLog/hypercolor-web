"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ModalSheet } from "@/components/ui/sheet";
import { findUxCatalogScene, UX_CATALOG_SCENES, type UxCatalogScene } from "./scenes";

const id = "ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u";

function Avatar({ label }: { label: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary hc-brand-text font-semibold">
      {label}
    </span>
  );
}

function Badge({ children }: { children: string }) {
  return <span className="rounded-full hc-brand-fill px-2 py-0.5 text-xs">{children}</span>;
}

function Row({ title, subtitle, badge }: { title: string; subtitle: string; badge?: string }) {
  return (
    <li className="flex min-h-11 items-center gap-3 border-b border-border py-3">
      <Avatar label={title.charAt(0)} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block truncate text-sm text-muted-foreground">{subtitle}</span>
      </span>
      {badge ? <Badge>{badge}</Badge> : null}
    </li>
  );
}

function Status({ children, alert = false }: { children: string; alert?: boolean }) {
  return (
    <div role={alert ? "alert" : "status"} className="rounded-md border border-border bg-card p-4 text-sm">
      {children}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-6 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Bubble({ mine, children, meta = "10:31 AM" }: { mine?: boolean; children: string; meta?: string }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`hc-bubble space-y-2 ${mine ? "hc-bubble-mine" : "hc-bubble-theirs"}`}>
        <p>{children}</p>
        <p className={`hc-meta ${mine ? "hc-on-brand-muted" : "text-muted-foreground"}`}>{meta}</p>
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-2" aria-label="Loading rows">
      <li className="h-11 animate-pulse rounded-md bg-secondary" />
      <li className="h-11 animate-pulse rounded-md bg-secondary" />
      <li className="h-11 animate-pulse rounded-md bg-secondary" />
    </ul>
  );
}

function SceneChrome({ scene }: { scene: UxCatalogScene }) {
  const colors = [
    "hc-scene-swatch-0",
    "hc-scene-swatch-1",
    "hc-scene-swatch-2",
    "hc-scene-swatch-3",
    "hc-scene-swatch-4",
    "hc-scene-swatch-5",
    "hc-scene-swatch-6",
    "hc-scene-swatch-7",
  ];
  const bands = [0, 1, 2, 3].map((offset) => {
    const code = scene.id.charCodeAt((offset * 7) % scene.id.length);
    return colors[(code + offset) % colors.length];
  });
  return (
    <header className="mb-6 border-b border-border pb-4">
      <div className="mb-4 grid grid-cols-4 overflow-hidden rounded-md border border-border" aria-hidden="true">
        {bands.map((band, index) => (
          <span key={`${band}-${index}`} className={`h-20 ${band}`} />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Hypercolor UX catalog</p>
      <h1 className="text-2xl font-semibold tracking-tight">{scene.surface}</h1>
      <p className="text-sm text-muted-foreground">{scene.journey} · {scene.state}</p>
      <div className="mt-4 rounded-md border border-border bg-card p-4">
        <p className="text-lg font-semibold">{scene.id}</p>
        <p className="text-sm text-muted-foreground">scene fixture revision w4b</p>
      </div>
    </header>
  );
}

function RenderScene({ scene }: { scene: UxCatalogScene }) {
  if (scene.id.startsWith("chrome-")) {
    return (
      <section className="space-y-4">
        <Status alert={scene.state === "offline"}>{scene.state === "locked" ? "Hypercolor is open in another tab. Only one tab can send." : "You are offline. Messages will send when you reconnect."}</Status>
        <nav aria-label="Primary" className="grid grid-cols-4 gap-2">
          {["Chats", "Channels", "Contacts", "Profile"].map((item) => (
            <a key={item} className="flex min-h-11 items-center justify-center rounded-md border border-border text-sm" href="#main-content">
              {item}
            </a>
          ))}
        </nav>
      </section>
    );
  }
  if (scene.surface === "welcome") {
    return (
      <section className="space-y-4 rounded-md border border-border bg-card p-6">
        <p className="text-3xl font-semibold">Hypercolor</p>
        <p className="text-muted-foreground">Pubky Ring holds your key. Hypercolor never sees it.</p>
        {scene.state === "loading" ? <SkeletonRows /> : null}
        {scene.state === "qr-populated" ? <div className="hc-qr-frame" data-testid="welcomeQr"><div className="h-44 w-44 bg-qrModules" /></div> : null}
        {scene.state === "expired" ? <Status>Authorization expired</Status> : null}
        {scene.state === "adopt-confirm" ? <Status>Continue as Aster Example?</Status> : null}
        {scene.state === "error" ? <p className="hc-danger-text">Could not start authorization.</p> : null}
        <Button>Connect with Pubky Ring</Button>
      </section>
    );
  }
  if (scene.surface === "enable") {
    return (
      <section className="space-y-4 rounded-md border border-border bg-card p-6">
        <h2 className="text-xl font-semibold">Enable encrypted messaging</h2>
        <p className="text-muted-foreground">Approve the Paykit and Hypercolor write scopes in Pubky Ring.</p>
        {scene.state === "checking" ? <SkeletonRows /> : null}
        {scene.state === "waiting-qr" ? <div className="hc-qr-frame" data-testid="enableMessagingQr"><div className="h-44 w-44 bg-qrModules" /></div> : null}
        {scene.state === "offline" ? <Status alert>You are offline. Messages will send when you reconnect.</Status> : null}
        {scene.state === "enabled" ? <Button>Open chats</Button> : <Button>Enable encrypted messaging</Button>}
      </section>
    );
  }
  if (scene.surface.includes("chats-list")) {
    return scene.state === "loading" ? <SkeletonRows /> : (
      <section className="space-y-4">
        <a className="flex min-h-11 items-center justify-between rounded-md border border-border bg-card px-3 py-2" href="#main-content">
          Message requests <Badge>2</Badge>
        </a>
        {scene.state.includes("empty") ? <EmptyState title="No chats yet." body="Add someone by pubky, then start a chat." /> : null}
        {scene.state === "populated" ? <ul><Row title="Aster Example" subtitle="See you in the thread" badge="3" /><Row title="Bramble Example" subtitle="Queued" /></ul> : null}
        {scene.state === "error" ? <p className="hc-danger-text">Could not load your chats.</p> : null}
      </section>
    );
  }
  if (scene.surface === "thread") {
    return (
      <section className="space-y-4">
        <Button variant="outline">Back to Chats</Button>
        <h2 className="text-xl font-semibold">Aster Example</h2>
        {scene.state === "empty" ? <EmptyState title="No messages yet." body="Say something. Only the two of you can read this." /> : null}
        {scene.state !== "empty" ? <><Bubble>Can you review this color pass?</Bubble><Bubble mine meta="10:32 AM · Sent">Looks good.</Bubble></> : null}
        {scene.state === "failed-retry" ? <Button variant="outline">Retry</Button> : null}
        {scene.state === "payment-notice" ? <div className="hc-bubble hc-bubble-theirs"><p className="font-medium">Payment request</p><p className="text-muted-foreground">Payments are not available on web. Open Hypercolor on mobile to act on this.</p></div> : null}
        {scene.state === "disabled-composer" ? <Status>Messaging not enabled</Status> : <div className="rounded-md border border-border bg-card p-3">Message composer</div>}
      </section>
    );
  }
  if (scene.surface === "requests") {
    return (
      <section className="space-y-4">
        <p className="text-muted-foreground">New inbound chats wait here until you accept.</p>
        {scene.state === "empty" ? <EmptyState title="No pending requests." body="New inbound chats wait here until you accept." /> : <ul><Row title="Cedar Example" subtitle={scene.state === "group-invite" ? "Group invitation · Design Review" : "Inbound message request"} /></ul>}
        <div className="rounded-md border border-border bg-card p-4">Someone who has never messaged you cannot reach this queue yet.</div>
      </section>
    );
  }
  if (scene.journey === "channels") {
    const publicInitial = scene.surface === "channels-public" && scene.state === "initial";
    return (
      <section className="space-y-4">
        <div role="tablist" className="grid grid-cols-2 rounded-md border border-border p-1"><Button variant="secondary">Private</Button><Button variant="ghost">Public</Button></div>
        {scene.surface.includes("public") ? <Status>Public — anything you post here is world-readable and permanent.</Status> : null}
        {publicInitial ? <Button>Load public topics</Button> : null}
        {scene.state.includes("empty") ? <EmptyState title={scene.surface === "public-topic" ? "No posts in this index for this tag." : "No private groups yet."} body="A private group is end-to-end encrypted to every member." /> : null}
        {!scene.state.includes("empty") && !publicInitial ? <ul><Row title="Design Review" subtitle="Private group · 2 minutes ago" /><Row title="release-notes" subtitle="Public topic · 28 posts" /></ul> : null}
        {scene.state === "members-open" ? <div className="rounded-md border border-border bg-card p-4"><p className="font-medium">Members</p><Row title="Aster Example" subtitle="admin" /></div> : null}
      </section>
    );
  }
  if (scene.journey === "contacts") {
    return (
      <section className="space-y-4">
        {scene.state === "empty" ? <EmptyState title="No contacts yet." body="Add someone by pubky, or use your public pubky.app follows." /> : null}
        {scene.state === "follows-consent" ? <div className="rounded-md border border-border bg-card p-4"><p className="font-medium">Use your pubky.app follows</p><p className="text-sm text-muted-foreground">Imported follows become suggestions, not contacts.</p><label className="mt-3 flex min-h-11 items-center gap-2"><input type="checkbox" /> I understand my follows are public.</label></div> : null}
        {scene.state !== "empty" && scene.state !== "follows-consent" ? <ul><Row title="Aster Example" subtitle={id} /><Row title="Bramble Example" subtitle="Mutual" /></ul> : null}
      </section>
    );
  }
  if (scene.journey === "profile") {
    return (
      <section className="space-y-4">
        <Avatar label="A" />
        <h2 className="text-xl font-semibold">{scene.state === "not-connected" ? "Not connected" : "Aster Example"}</h2>
        <p className="text-muted-foreground">Pubky Ring holds your key. Hypercolor never sees it.</p>
        {scene.surface === "sign-out" ? <ModalSheet open onClose={() => undefined} role="alertdialog"><h2 className="text-lg font-semibold">Sign out of Hypercolor?</h2><p className="text-sm text-muted-foreground">This device deletes your chats, groups, contacts, attachments, and the Paykit session.</p><Button variant="destructive">Sign out</Button></ModalSheet> : null}
      </section>
    );
  }
  if (scene.journey === "settings") {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Settings</h2>
        <div className="rounded-md border border-border bg-card p-4"><p className="font-medium">Encrypted backup</p><p className="text-sm text-muted-foreground">A backup encrypts your local history with a recovery code.</p></div>
        {scene.state === "recovery-gate" ? <div data-testid="recoveryCode" className="rounded-md border border-border bg-secondary p-4 font-mono">word word word word</div> : null}
        {scene.state === "restore-success" ? <Status>Restore complete. History is local.</Status> : null}
        {scene.state === "error" ? <p className="hc-danger-text">That recovery code did not work.</p> : null}
      </section>
    );
  }
  if (scene.surface === "ring-callback") {
    return <Status>{scene.state === "done" ? "Connected. Enable messaging next." : scene.state === "error" ? "Could not complete authorization." : "Reading Pubky Ring response…"}</Status>;
  }
  return (
    <section className="space-y-4">
      <div className="rounded-md border border-border bg-card p-4">
        <p className="font-medium">{scene.surface}</p>
        <p className="text-sm text-muted-foreground">{scene.state}</p>
      </div>
      <Button variant="outline">{scene.id.includes("failed") ? "Retry" : "Cancel"}</Button>
    </section>
  );
}

export function UxCatalog() {
  const searchParams = useSearchParams();
  const sceneId = searchParams.get("scene");
  const scene = findUxCatalogScene(sceneId);
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = () => Promise.reject(new Error("UX catalog blocks network"));
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return (
    <div data-vrt-scene={scene.id} className="space-y-6">
      <SceneChrome scene={scene} />
      <RenderScene scene={scene} />
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
