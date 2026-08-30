import Link from "next/link";
import { APP_NAME, HYPERCOLOR_WIRE_PIN } from "@/lib/app-meta";

export default function HomePage() {
  return (
    <article className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-muted-foreground leading-7">
        Web client for Hypercolor Encrypted Links. The wire contract matches
        mobile Hypercolor at{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
          {HYPERCOLOR_WIRE_PIN.slice(0, 7)}
        </code>
        . BLE mesh is omitted. The homeserver is the backend — this app is a
        static export and does not run Route Handlers.
      </p>
      <p className="text-muted-foreground leading-7">
        Sign-in is a Pubky Ring{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
          pubkyauth
        </code>{" "}
        session that authorizes owner PUTs. AppCert is UKD-only and is not
        used as a homeserver credential. Session wiring lands in a later
        wave; the{" "}
        <Link href="/ring-callback" className="underline underline-offset-4">
          Ring callback
        </Link>{" "}
        page already reads the return URL.
      </p>
      <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
        <li>
          <Link href="/chats" className="underline underline-offset-4">
            Chats
          </Link>
        </li>
        <li>
          <Link href="/contacts" className="underline underline-offset-4">
            Contacts
          </Link>
        </li>
        <li>
          <Link href="/enable" className="underline underline-offset-4">
            Enable messaging
          </Link>
        </li>
      </ul>
    </article>
  );
}
