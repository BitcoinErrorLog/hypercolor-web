#!/usr/bin/env node
/**
 * Local: start Next on the boot-disk shadow app, wait until `/` is healthy,
 * then run the Ring proof. Playwright does not spawn Next itself.
 *
 * Remote (`PLAYWRIGHT_BASE_URL=https://…`): do not start a local server;
 * run the same spec against that origin.
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

delete process.env.NEXT_DIST_DIR;

const existingBase = process.env.PLAYWRIGHT_BASE_URL ?? "";
const remote =
  existingBase.startsWith("http://") || existingBase.startsWith("https://")
    ? !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(existingBase)
    : false;

function runPlaywright(env) {
  const play = spawn("npx", ["playwright", "test", "e2e/ring-staging.spec.ts"], {
    stdio: "inherit",
    env,
  });
  return new Promise((resolve) => {
    play.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
}

if (remote) {
  process.exit(
    await runPlaywright({
      ...process.env,
      RUN_STAGING_RING: "1",
    }),
  );
}

const port = process.env.PLAYWRIGHT_RING_PORT ?? "3010";
const base = `http://127.0.0.1:${port}`;

const server = spawn("node", ["e2e/support/run-next-local.mjs", "--port", port], {
  stdio: "inherit",
  env: { ...process.env, COPYFILE_DISABLE: "1", NEXT_PUBLIC_APP_ORIGIN: base },
});

function shutdown() {
  if (!server.killed) server.kill("SIGTERM");
}

async function waitHealthy() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const pages = await Promise.all(
        ["/", "/chats", "/enable"].map((path) => fetch(`${base}${path}`)),
      );
      if (pages.every((res) => res.ok)) return;
    } catch {
      // still booting
    }
    await delay(400);
  }
  throw new Error(`Next did not become ready at ${base}`);
}

try {
  await waitHealthy();
  const code = await runPlaywright({
    ...process.env,
    PLAYWRIGHT_BASE_URL: base,
    RUN_STAGING_RING: "1",
    NEXT_PUBLIC_APP_ORIGIN: base,
  });
  shutdown();
  process.exit(code);
} catch (error) {
  shutdown();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
