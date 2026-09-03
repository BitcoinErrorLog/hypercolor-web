export type UxCatalogScene = {
  id: string;
  journey: string;
  surface: string;
  state: string;
};

export const UX_CATALOG_SCENES: readonly UxCatalogScene[] = [
  { id: "chrome-nav-no-identity", journey: "chrome", surface: "nav", state: "no-identity" },
  { id: "chrome-nav-needs-enable", journey: "chrome", surface: "nav", state: "needs-enable" },
  { id: "chrome-nav-enabled", journey: "chrome", surface: "nav", state: "enabled" },
  { id: "chrome-session-offline", journey: "chrome", surface: "session-banner", state: "offline" },
  { id: "chrome-tab-lock", journey: "chrome", surface: "tab-lock", state: "locked" },
  { id: "welcome-loading", journey: "connect", surface: "welcome", state: "loading" },
  { id: "welcome-qr-populated", journey: "connect", surface: "welcome", state: "qr-populated" },
  { id: "welcome-expired", journey: "connect", surface: "welcome", state: "expired" },
  { id: "welcome-adopt-confirm", journey: "connect", surface: "welcome", state: "adopt-confirm" },
  { id: "welcome-error", journey: "connect", surface: "welcome", state: "error" },
  { id: "enable-checking", journey: "enable", surface: "enable", state: "checking" },
  { id: "enable-waiting-qr", journey: "enable", surface: "enable", state: "waiting-qr" },
  { id: "enable-offline", journey: "enable", surface: "enable", state: "offline" },
  { id: "enable-enabled", journey: "enable", surface: "enable", state: "enabled" },
  { id: "chats-loading", journey: "chats", surface: "chats-list", state: "loading" },
  { id: "chats-empty-enable", journey: "chats", surface: "chats-list", state: "empty-enable" },
  { id: "chats-populated", journey: "chats", surface: "chats-list", state: "populated" },
  { id: "chats-error", journey: "chats", surface: "chats-list", state: "error" },
  { id: "thread-empty", journey: "chats", surface: "thread", state: "empty" },
  { id: "thread-populated", journey: "chats", surface: "thread", state: "populated" },
  { id: "thread-failed-retry", journey: "chats", surface: "thread", state: "failed-retry" },
  { id: "thread-payment-notice", journey: "chats", surface: "thread", state: "payment-notice" },
  { id: "thread-disabled-composer", journey: "chats", surface: "thread", state: "disabled-composer" },
  { id: "requests-empty", journey: "requests", surface: "requests", state: "empty" },
  { id: "requests-populated", journey: "requests", surface: "requests", state: "populated" },
  { id: "requests-group-invite", journey: "requests", surface: "requests", state: "group-invite" },
  { id: "requests-busy", journey: "requests", surface: "requests", state: "busy" },
  { id: "channels-private-empty", journey: "channels", surface: "channels-private", state: "empty" },
  { id: "channels-private-populated", journey: "channels", surface: "channels-private", state: "populated" },
  { id: "channels-public-initial", journey: "channels", surface: "channels-public", state: "initial" },
  { id: "channels-public-populated", journey: "channels", surface: "channels-public", state: "populated" },
  { id: "channel-empty", journey: "channels", surface: "channel", state: "empty" },
  { id: "channel-populated", journey: "channels", surface: "channel", state: "populated" },
  { id: "channel-members-open", journey: "channels", surface: "channel", state: "members-open" },
  { id: "public-topic-empty", journey: "channels", surface: "public-topic", state: "empty" },
  { id: "public-topic-populated", journey: "channels", surface: "public-topic", state: "populated" },
  { id: "contacts-empty", journey: "contacts", surface: "contacts", state: "empty" },
  { id: "contacts-follows-consent", journey: "contacts", surface: "contacts", state: "follows-consent" },
  { id: "contacts-search-results", journey: "contacts", surface: "contacts", state: "search-results" },
  { id: "contacts-populated", journey: "contacts", surface: "contacts", state: "populated" },
  { id: "contact-detail-trust", journey: "contacts", surface: "contact-detail", state: "trust" },
  { id: "contact-detail-not-found", journey: "contacts", surface: "contact-detail", state: "not-found" },
  { id: "profile-not-connected", journey: "profile", surface: "profile", state: "not-connected" },
  { id: "profile-enabled", journey: "profile", surface: "profile", state: "enabled" },
  { id: "profile-sign-out", journey: "profile", surface: "sign-out", state: "confirm" },
  { id: "settings-default", journey: "settings", surface: "settings", state: "default" },
  { id: "settings-recovery-gate", journey: "settings", surface: "settings", state: "recovery-gate" },
  { id: "settings-restore-success", journey: "settings", surface: "settings", state: "restore-success" },
  { id: "settings-error", journey: "settings", surface: "settings", state: "error" },
  { id: "ring-callback-reading", journey: "connect", surface: "ring-callback", state: "reading" },
  { id: "ring-callback-confirm", journey: "connect", surface: "ring-callback", state: "confirm" },
  { id: "ring-callback-done", journey: "connect", surface: "ring-callback", state: "done" },
  { id: "ring-callback-error", journey: "connect", surface: "ring-callback", state: "error" },
  { id: "composer-menu", journey: "composer", surface: "composer-menu", state: "open" },
  { id: "attachment-failed", journey: "composer", surface: "attachment", state: "failed" },
  { id: "attachment-unavailable", journey: "composer", surface: "attachment", state: "unavailable" },
] as const;

export function findUxCatalogScene(id: string | null): UxCatalogScene {
  return UX_CATALOG_SCENES.find((scene) => scene.id === id) ?? UX_CATALOG_SCENES[0];
}
