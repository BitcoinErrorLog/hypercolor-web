import { WOT_AUTO_ACCEPT_TRUST_THRESHOLD } from "./flags/config";

/**
 * Web stand-in for mobile `src/flags` (MMKV AppConfig).
 * `wotGate.resolveWotAutoAcceptThreshold` lazy-requires this module.
 */
export const AppConfig = {
  getWotAutoAcceptTrustThreshold(): number {
    return WOT_AUTO_ACCEPT_TRUST_THRESHOLD;
  },
};
