export const FIXTURE_NOW = 1_720_000_000_000;

export const SELF = {
  name: "Ada",
  pubky: "o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy",
};

export const CONTACTS = [
  {
    name: "Satoshi",
    pubky: "pkq9m2w8r4t6y1u3i5o7p0a2s4d6f8g0h1j3k5l7n9m2b4v6c8x",
    bio: "Building Hypercolor channels on Pubky.",
  },
  {
    name: "Jules",
    pubky: "ab12cd34ef56gh78ij90kl12mn34op56qr78st90uv12wx34yz56",
    bio: "Designs the Ring handshake.",
  },
  {
    name: "Mira",
    pubky: "zz11yy22xx33ww44vv55uu66tt77ss88rr99qq00pp11oo22nn33",
    bio: "Keeps the homeserver honest.",
  },
] as const;

export const CHATS = [
  {
    id: "chat-satoshi",
    peer: CONTACTS[0],
    preview: "Bring the verification code to Ring.",
    sentAt: FIXTURE_NOW - 12 * 60_000,
    unread: 2,
  },
  {
    id: "chat-jules",
    peer: CONTACTS[1],
    preview: "Composer is retokened — mine uses brand.",
    sentAt: FIXTURE_NOW - 3 * 3600_000,
    unread: 0,
  },
] as const;

export const THREAD = [
  { id: "m1", mine: false, body: "Scan this from Ring when you are ready.", sentAt: FIXTURE_NOW - 40 * 60_000 },
  { id: "m2", mine: true, body: "Code is 7K2M. Waiting on your confirm.", sentAt: FIXTURE_NOW - 38 * 60_000 },
  { id: "m3", mine: false, body: "Both scopes listed — Hypercolor + Paykit.", sentAt: FIXTURE_NOW - 12 * 60_000 },
] as const;

export const CHANNELS = [
  { id: "chan-design", title: "#design", topic: "Hypercolor shell tokens", unread: 4 },
  { id: "chan-wire", title: "#wire", topic: "Encrypted links", unread: 0 },
  { id: "chan-ops", title: "#ops", topic: "Homeserver status", unread: 1 },
] as const;

export const REQUESTS = [
  { name: "Kai", pubky: "kai0pubkyabcdefghijklmnopqrstuvwxyz1234567890abcd12", scopes: ["hypercolor", "paykit"] },
  { name: "Noor", pubky: "noorpubkyabcdefghijklmnopqrstuvwxyz1234567890abcd12", scopes: ["hypercolor"] },
] as const;

export const WELCOME = {
  authUrl: "pubkyauth:///?relay=https://relay.staging.pubky.app&secret=designfixture",
  verification: "7K2M",
};

export const CONNECT = {
  displayName: "Ada",
  pubky: SELF.pubky,
  scopes: [
    { id: "hypercolor", label: "Hypercolor messaging", detail: "Read and write encrypted links on this device." },
    { id: "paykit", label: "Paykit", detail: "Resolve payment endpoints when a contact shares one." },
  ],
} as const;
