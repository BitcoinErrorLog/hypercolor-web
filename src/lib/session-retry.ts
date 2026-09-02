import { getEnableStatus, restoreSessionOnLoad } from "@/services/link/session";
import { KeyStore } from "@/services/KeyStore";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

/** Re-runs session restore. Shared by the session banner and offline CTAs. */
export async function retrySessionRestore(): Promise<void> {
  const restore = await restoreSessionOnLoad();
  let enable;
  try {
    enable = await getEnableStatus();
  } catch {
    enable = undefined;
  }
  const pubky = (await KeyStore.getPubky()) ?? useAuthStore.getState().pubky;
  useSessionStatusStore.getState().setFromRestore(restore, enable, {
    hasIdentity: Boolean(pubky),
  });
}
