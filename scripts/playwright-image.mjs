import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PLAYWRIGHT_DOCKER_DISTRO = "jammy";
export const PLAYWRIGHT_DOCKER_PLATFORM = "linux/amd64";

export function playwrightVersionFromLock(repoRoot) {
  const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
  const version = lock.packages?.["node_modules/@playwright/test"]?.version;
  if (!version) {
    throw new Error("package-lock.json is missing node_modules/@playwright/test version");
  }
  return version;
}

export function playwrightDockerImage(repoRoot) {
  return `mcr.microsoft.com/playwright:v${playwrightVersionFromLock(repoRoot)}-${PLAYWRIGHT_DOCKER_DISTRO}`;
}
