import { formatRingVerificationCode } from "@/services/ringChannelId";

export const FIXTURE_NOW = 1_720_000_000_000;

export const SELF = {
  name: "Ada",
  pubky: "o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy",
};

export const CONTACTS = [
  {
    name: "Satoshi",
    pubky: "pkq9m2w8r4t6y1u3i5o7p0a2s4d6f8g0h1j3k5l7n9m2b4v6c8x",
    bio: "Working on public channels and weekend relays.",
  },
  {
    name: "Jules",
    pubky: "ab12cd34ef56gh78ij90kl12mn34op56qr78st90uv12wx34yz56",
    bio: "Ships Ring approvals and recovery flow.",
  },
  {
    name: "Mira",
    pubky: "zz11yy22xx33ww44vv55uu66tt77ss88rr99qq00pp11oo22nn33",
    bio: "On-call for the staging homeserver.",
  },
  {
    name: "Theo",
    pubky: "theo9m2w8r4t6y1u3i5o7p0a2s4d6f8g0h1j3k5l7n9m2b4v6c8",
    bio: "Collects invoices for the Berlin meetup.",
  },
] as const;

export const CHATS = [
  {
    id: "chat-satoshi",
    peer: CONTACTS[0],
    preview: "Can you send the channel invite before 6?",
    sentAt: FIXTURE_NOW - 12 * 60_000,
    unread: 2,
  },
  {
    id: "chat-jules",
    peer: CONTACTS[1],
    preview: "Approved the session from Ring.",
    sentAt: FIXTURE_NOW - 3 * 3600_000,
    unread: 0,
  },
  {
    id: "chat-mira",
    peer: CONTACTS[2],
    preview: "Homeserver is green again.",
    sentAt: FIXTURE_NOW - 26 * 3600_000,
    unread: 0,
  },
  {
    id: "chat-theo",
    peer: CONTACTS[3],
    preview: "Invoice is in the thread.",
    sentAt: FIXTURE_NOW - 52 * 3600_000,
    unread: 1,
  },
] as const;

export const THREAD = [
  { id: "m1", mine: false, body: "Are you around to open the #design channel?", sentAt: FIXTURE_NOW - 40 * 60_000 },
  { id: "m2", mine: true, body: "Yes — I will send the invite after lunch.", sentAt: FIXTURE_NOW - 38 * 60_000 },
  { id: "m3", mine: false, body: "Can you send the channel invite before 6?", sentAt: FIXTURE_NOW - 12 * 60_000 },
] as const;

export const CHANNELS = [
  { id: "chan-design", title: "#design", topic: "Notes from this week’s visual review.", unread: 4 },
  { id: "chan-wire", title: "#wire", topic: "Encrypted-link debugging.", unread: 0 },
  { id: "chan-ops", title: "#ops", topic: "Homeserver status and deploys.", unread: 1 },
  { id: "chan-berlin", title: "#berlin", topic: "Meetup logistics.", unread: 0 },
] as const;

export const CHANNEL_THREAD = [
  { id: "c1", mine: false, sender: "Jules", body: "Posting the latest frames in this thread.", sentAt: FIXTURE_NOW - 90 * 60_000 },
  { id: "c2", mine: true, body: "Thanks — I will leave notes on the header tonight.", sentAt: FIXTURE_NOW - 80 * 60_000 },
  { id: "c3", mine: false, sender: "Mira", body: "Staging is quiet if anyone needs a dry run.", sentAt: FIXTURE_NOW - 20 * 60_000 },
] as const;

export const REQUESTS = [
  {
    name: "Kai",
    pubky: "kai0pubkyabcdefghijklmnopqrstuvwxyz1234567890abcd12",
    note: "Wants to message you and pay an invoice.",
    scopes: [
      { id: "hypercolor", label: "Hypercolor messaging", detail: "Read and write encrypted links on this device." },
      { id: "paykit", label: "Paykit", detail: "Resolve payment endpoints when a contact shares one." },
    ],
  },
  {
    name: "Noor",
    pubky: "noorpubkyabcdefghijklmnopqrstuvwxyz1234567890abcd12",
    note: "Follow-up from the Berlin meetup.",
    scopes: [{ id: "hypercolor", label: "Hypercolor messaging", detail: "Read and write encrypted links on this device." }],
  },
] as const;

const WELCOME_CHANNEL = "QIKcU9ringcallbackfixturechannelid";

export const WELCOME = {
  authUrl: "pubkyauth:///?relay=https://relay.staging.pubky.app&secret=designfixture",
  verification: formatRingVerificationCode(WELCOME_CHANNEL),
};

export const CONNECT = {
  displayName: "Ada",
  pubky: SELF.pubky,
  scopes: [
    { id: "hypercolor", label: "Hypercolor messaging", detail: "Read and write encrypted links on this device." },
    { id: "paykit", label: "Paykit", detail: "Resolve payment endpoints when a contact shares one." },
  ],
} as const;
