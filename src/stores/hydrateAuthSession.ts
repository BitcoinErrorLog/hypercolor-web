import { KeyStore } from "../services/KeyStore";
import { useAuthStore } from "./authStore";

/**
 * After `KeyStore.initKeyStore()`, restore `isAuthenticated` from the
 * persisted Welcome identity (delegated AppKey + pubky). Does not create a
 * Paykit homeserver session — that comes from Enable Messaging.
 */
export async function hydratePersistedAuth(): Promise<boolean> {
  if (!(await KeyStore.hasPersistedSession())) return false;
  const pubky = await KeyStore.getPubky();
  const homeserver = await KeyStore.getHomeserver();
  if (!pubky || !homeserver) return false;
  useAuthStore.getState().setAuthenticated(pubky, homeserver);
  return true;
}
