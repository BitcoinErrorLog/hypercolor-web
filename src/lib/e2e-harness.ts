export function isE2eHarnessEnabled(): boolean {
  return process.env.NEXT_PUBLIC_E2E_HARNESS === "1";
}
