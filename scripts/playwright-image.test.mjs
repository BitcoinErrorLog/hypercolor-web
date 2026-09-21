import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { playwrightDockerImage } from "./playwright-image.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("playwright docker pin", () => {
  it("pins CI production-hooks to the lockfile Playwright jammy image", () => {
    const image = playwrightDockerImage(root);
    const yaml = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    expect(image).toMatch(/^mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-jammy$/);
    expect(yaml).toContain(`image: ${image}`);
    expect(yaml).toContain("PLAYWRIGHT_IN_DOCKER");
    expect(yaml).not.toMatch(/npx playwright install/);
    const docker = readFileSync(join(root, "scripts/playwright-docker.mjs"), "utf8");
    expect(docker).toContain("linux/amd64");
    expect(docker).toContain("restoreHostNodeModulesLink");
    expect(docker).toContain("extraGitMounts");
    expect(docker).toContain("commondir");
    expect(docker).toContain("safe.directory");
    expect(docker).toContain("._*");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts["test:e2e:static"]).toContain("playwright-docker.mjs");
    expect(pkg.scripts["vrt:update"]).toContain("playwright-docker.mjs");
  });
});
