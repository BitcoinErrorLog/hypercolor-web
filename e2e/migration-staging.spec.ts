import { chromium, expect, test, type Page } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GENERATE =
  process.env.STAGING_INVITE_SCRIPT ??
  "/Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const LOCAL_ADMIN =
  process.env.LOCAL_HOMESERVER_ADMIN ?? "http://127.0.0.1:6288";
const LOCAL_ADMIN_PASSWORD = process.env.LOCAL_HOMESERVER_ADMIN_PASSWORD ?? "admin";
const STAGING_ADMIN =
  process.env.STAGING_ADMIN_URL ??
  "https://admin.homeserver.staging.pubky.app";
const Z32_FILE =
  process.env.LOCAL_HOMESERVER_Z32_FILE ??
  "/tmp/hypercolor-migration-homeserver/z32.txt";

/** Max wait for Encrypted Link to re-handshake after migrate (fail fast). */
const POST_MIGRATE_LINK_DEADLINE_MS = 120_000;
/** Short probe before cache bust — measures whether pkarr updates immediately. */
const RAW_PKARR_PROBE_MS = 120_000;
/** pkarr packet TTL is 3600s; optional extended probe (skipped when set). */
const PKARR_PROPAGATION_DEADLINE_MS = 70 * 60 * 1000;
const POLL_MS = 2_000;

type SignupResult = { pubky: string; receiverPath: string };

test.use({ trace: "off", video: "off" });

function readLocalHomeserverZ32(): string {
  const fromEnv = process.env.LOCAL_HOMESERVER_Z32?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = readFileSync(Z32_FILE, "utf8").trim();
    if (fromFile.length === 52) return fromFile;
  } catch {
    // fall through
  }
  throw new Error(
    `LOCAL_HOMESERVER_Z32 is required (env or ${Z32_FILE}). Start the local homeserver first.`,
  );
}

function stagingAdminPassword(): string {
  const fromEnv = process.env.STAGING_ADMIN_PASSWORD?.trim();
  if (fromEnv) return fromEnv;
  const script = readFileSync(GENERATE, "utf8");
  const match = script.match(/^ADMIN_PASSWORD="([^"]+)"/m);
  if (!match?.[1]) {
    throw new Error("staging admin password is not available");
  }
  return match[1];
}

async function mintStagingToken(): Promise<string> {
  const { stdout } = await execFileAsync("bash", [GENERATE], {
    timeout: 20_000,
  });
  const token = stdout.trim();
  if (!token) throw new Error("staging invite script returned an empty token");
  return token;
}

async function mintLocalToken(): Promise<string> {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-sS",
      "--fail-with-body",
      "--max-time",
      "15",
      "-H",
      `X-Admin-Password: ${LOCAL_ADMIN_PASSWORD}`,
      `${LOCAL_ADMIN.replace(/\/+$/, "")}/generate_signup_token`,
    ],
    { timeout: 20_000 },
  );
  const token = stdout.trim();
  if (!token) throw new Error("local homeserver invite endpoint returned empty");
  return token;
}

async function resolveTokens(): Promise<{ a: string; b: string } | null> {
  const envA = process.env.STAGING_SIGNUP_TOKEN_A?.trim();
  const envB = process.env.STAGING_SIGNUP_TOKEN_B?.trim();
  if (envA && envB) return { a: envA, b: envB };
  if (process.env.RUN_STAGING_MIGRATION !== "1") return null;
  return { a: await mintStagingToken(), b: await mintStagingToken() };
}

async function waitHarness(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Homeserver migration harness" }),
  ).toBeVisible();
  await page.waitForFunction(
    () =>
      typeof window.runMigrationSignup === "function" &&
      typeof window.runMigrationTo === "function" &&
      typeof window.runMigrationRebindPeer === "function" &&
      typeof window.runMigrationRebindPeerLink === "function" &&
      typeof window.runMigrationBustPeerHomeserver === "function" &&
      typeof window.runDmEnsure === "function" &&
      typeof window.runDmSend === "function" &&
      typeof window.runDmSync === "function",
  );
}

async function signup(page: Page, token: string): Promise<SignupResult> {
  return page.evaluate(async (signupToken) => {
    const run = window.runMigrationSignup;
    if (!run) throw new Error("window.runMigrationSignup is not installed");
    return run(signupToken);
  }, token);
}

async function ensureReady(
  pageA: Page,
  pageB: Page,
  pubkyA: string,
  pubkyB: string,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  let statusA = "";
  let statusB = "";
  while (Date.now() < deadline) {
    statusA = await pageA.evaluate(async (peer) => window.runDmEnsure!(peer), pubkyB);
    statusB = await pageB.evaluate(async (peer) => window.runDmEnsure!(peer), pubkyA);
    if (statusA === "ready" && statusB === "ready") return;
    await pageA.waitForTimeout(1500);
  }
  expect(statusA, "A did not reach a ready Encrypted Link").toBe("ready");
  expect(statusB, "B did not reach a ready Encrypted Link").toBe("ready");
}

async function sendAndExpectKnownPeer(
  sender: Page,
  receiver: Page,
  senderPeer: string,
  receiverPeer: string,
  body: string,
): Promise<boolean> {
  await sender.evaluate(async ({ peer, body: text }) => window.runDmSend!(peer, text), {
    peer: senderPeer,
    body,
  });
  const bodies = await receiver.evaluate(async (peer) => {
    const rows = await window.runDmSync!([peer]);
    return rows.map((row) => row.body);
  }, receiverPeer);
  return bodies.includes(body);
}

async function pollUntil(
  label: string,
  deadlineMs: number,
  attempt: () => Promise<boolean>,
): Promise<number> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() < started + deadlineMs) {
    try {
      if (await attempt()) return Date.now() - started;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(
    `${label} did not succeed within ${deadlineMs}ms${lastError ? ` (last error: ${lastError})` : ""}`,
  );
}

function stagingAdmin(
  method: string,
  path: string,
): { status: number; body: string } {
  const url = `${STAGING_ADMIN.replace(/\/+$/, "")}${path}`;
  const password = stagingAdminPassword();
  try {
    const stdout = execFileSync(
      "curl",
      [
        "-sS",
        "-o",
        "-",
        "-w",
        "\n%{http_code}",
        "--max-time",
        "20",
        "-X",
        method,
        "-H",
        `X-Admin-Password: ${password}`,
        url,
      ],
      { encoding: "utf8", timeout: 25_000 },
    );
    const trimmed = stdout.trim();
    const nl = trimmed.lastIndexOf("\n");
    const body = nl >= 0 ? trimmed.slice(0, nl) : "";
    const status = Number(nl >= 0 ? trimmed.slice(nl + 1) : trimmed);
    return { status, body };
  } catch (error) {
    const err = error as { stdout?: string; status?: number };
    return {
      status: typeof err.status === "number" ? err.status : 0,
      body: typeof err.stdout === "string" ? err.stdout : "",
    };
  }
}

function attachmentHomeserverPath(location: string, ownerPubky: string): string {
  const prefix = `pubky://${ownerPubky}`;
  if (!location.startsWith(prefix)) {
    throw new Error("attachment location is not owned by the expected pubky");
  }
  return location.slice(prefix.length);
}

async function establishPair(
  pageA: Page,
  pageB: Page,
  tokens: { a: string; b: string },
): Promise<{ a: SignupResult; b: SignupResult }> {
  const signedA = await signup(pageA, tokens.a);
  const signedB = await signup(pageB, tokens.b);
  expect(signedA.pubky.length).toBe(52);
  expect(signedB.pubky.length).toBe(52);
  expect(signedA.pubky).not.toBe(signedB.pubky);
  await ensureReady(pageA, pageB, signedA.pubky, signedB.pubky);
  return { a: signedA, b: signedB };
}

test.describe.configure({ mode: "serial" });

test("A migrates homeserver; B keeps talking without re-adding A", async () => {
  test.setTimeout(90 * 60_000);
  const tokens = await resolveTokens();
  test.skip(
    !tokens,
    [
      "Live migration proof skipped (no tokens).",
      `  RUN_STAGING_MIGRATION=1 LOCAL_HOMESERVER_Z32=<z32> npm run proof:staging:migration`,
    ].join("\n"),
  );
  const localZ32 = readLocalHomeserverZ32();
  expect(localZ32.length).toBe(52);

  const browserA = await chromium.launch();
  const browserB = await chromium.launch();
  try {
    const pageA = await (await browserA.newContext()).newPage();
    const pageB = await (await browserB.newContext()).newPage();
    await pageA.goto(`${BASE_URL}/e2e/migration-harness`);
    await pageB.goto(`${BASE_URL}/e2e/migration-harness`);
    await waitHarness(pageA);
    await waitHarness(pageB);

    const { a: signedA, b: signedB } = await establishPair(pageA, pageB, tokens!);

    expect(
      await sendAndExpectKnownPeer(
        pageA,
        pageB,
        signedB.pubky,
        signedA.pubky,
        "pre-migrate-from-a",
      ),
    ).toBe(true);
    expect(
      await sendAndExpectKnownPeer(
        pageB,
        pageA,
        signedA.pubky,
        signedB.pubky,
        "pre-migrate-from-b",
      ),
    ).toBe(true);

    const identityBefore = await pageA.evaluate(() => window.runMigrationIdentity!());
    expect(identityBefore.pubky).toBe(signedA.pubky);

    const localToken = await mintLocalToken();
    const migrated = await pageA.evaluate(
      async ({ host, token }) => window.runMigrationTo!(host, token),
      { host: localZ32, token: localToken },
    );
    expect(migrated.pubky).toBe(signedA.pubky);
    expect(migrated.receiverPath).toBe(signedA.receiverPath);

    const postMigrateEnsureA = await pageA.evaluate(
      async (peer) => window.runDmEnsure!(peer),
      signedB.pubky,
    );
    expect(postMigrateEnsureA, "A must not be needs-enable after migrate rebind").not.toBe(
      "needs-enable",
    );

    await pageB.evaluate(
      async (peer) => window.runMigrationRebindPeerLink!(peer),
      signedA.pubky,
    );

    const identityAfter = await pageA.evaluate(() => window.runMigrationIdentity!());
    expect(identityAfter.pubky, "pubky must be unchanged after migrate").toBe(
      signedA.pubky,
    );

    const republishAt = Date.now();
    let rawPkarrPropagationMs: number | null = null;
    let rawPkarrProbeError = "";
    try {
      rawPkarrPropagationMs = await pollUntil(
        "A→B after migrate without pkarr cache bust (TTL probe)",
        RAW_PKARR_PROBE_MS,
        () =>
          sendAndExpectKnownPeer(
            pageA,
            pageB,
            signedB.pubky,
            signedA.pubky,
            `post-migrate-from-a-${Date.now()}`,
          ),
      );
    } catch (error) {
      rawPkarrProbeError = error instanceof Error ? error.message : String(error);
    }

    await pageB.evaluate(
      async (peer) => window.runMigrationRebindPeer!(peer),
      signedA.pubky,
    );
    await pageA.evaluate(
      async (peer) => window.runMigrationRebindPeerLink!(peer),
      signedB.pubky,
    );
    await waitHarness(pageA);
    await waitHarness(pageB);

    const markerOnNewHost = await pageB.evaluate(
      async (peer) => window.runMigrationProbeMarker!(peer),
      signedA.pubky,
    );
    expect(markerOnNewHost.found, "B must resolve A's receiver on the new host").toBe(true);

    await ensureReady(pageA, pageB, signedA.pubky, signedB.pubky);

    const afterCacheBustMs = await pollUntil(
      "A→B after pkarr cache bust (required proof)",
      POST_MIGRATE_LINK_DEADLINE_MS,
      () =>
        sendAndExpectKnownPeer(
          pageA,
          pageB,
          signedB.pubky,
          signedA.pubky,
          `post-migrate-cache-bust-${Date.now()}`,
        ),
    );

    let bToAMs: number | null = null;
    let bToAError = "";
    try {
      bToAMs = await pollUntil(
        "B→A after migrate (informational)",
        POST_MIGRATE_LINK_DEADLINE_MS,
        () =>
          sendAndExpectKnownPeer(
            pageB,
            pageA,
            signedA.pubky,
            signedB.pubky,
            `post-migrate-from-b-${Date.now()}`,
          ),
      );
    } catch (error) {
      bToAError = error instanceof Error ? error.message : String(error);
    }

    const bDidNotReadd = await pageB.evaluate(() => window.runMigrationIdentity!());
    expect(bDidNotReadd.pubky).toBe(signedB.pubky);
    const stillKnowsA = await pageB.evaluate(
      async (peer) => window.runDmEnsure!(peer),
      signedA.pubky,
    );
    expect(stillKnowsA).toBe("ready");

    console.log(
      JSON.stringify({
        scenario: "graceful-migrate",
        rawPkarrPropagationMs,
        rawPkarrProbeMs: RAW_PKARR_PROBE_MS,
        rawPkarrProbeError: rawPkarrProbeError || undefined,
        afterCacheBustMs,
        republishToBtoAMs: bToAMs,
        bToAError: bToAError || undefined,
        measuredFrom: republishAt,
        pkarrPropagationUpperBoundMs: PKARR_PROPAGATION_DEADLINE_MS,
      }),
    );
  } finally {
    await browserA.close();
    await browserB.close();
  }
});

test("A is banned on staging then migrates; report what survives", async () => {
  test.setTimeout(90 * 60_000);
  const tokens = await resolveTokens();
  test.skip(
    !tokens,
    [
      "Live ban+migration proof skipped (no tokens).",
      `  RUN_STAGING_MIGRATION=1 LOCAL_HOMESERVER_Z32=<z32> npm run proof:staging:migration`,
    ].join("\n"),
  );
  const localZ32 = readLocalHomeserverZ32();

  const browserA = await chromium.launch();
  const browserB = await chromium.launch();
  try {
    const pageA = await (await browserA.newContext()).newPage();
    const pageB = await (await browserB.newContext()).newPage();
    await pageA.goto(`${BASE_URL}/e2e/migration-harness`);
    await pageB.goto(`${BASE_URL}/e2e/migration-harness`);
    await waitHarness(pageA);
    await waitHarness(pageB);

    const { a: signedA, b: signedB } = await establishPair(pageA, pageB, tokens!);
    expect(
      await sendAndExpectKnownPeer(
        pageA,
        pageB,
        signedB.pubky,
        signedA.pubky,
        "pre-ban-from-a",
      ),
    ).toBe(true);
    expect(
      await sendAndExpectKnownPeer(
        pageB,
        pageA,
        signedA.pubky,
        signedB.pubky,
        "pre-ban-from-b",
      ),
    ).toBe(true);

    const uploaded = await pageA.evaluate(() => window.runMigrationPutAttachment!());
    expect(uploaded.location.startsWith(`pubky://${signedA.pubky}/`)).toBe(true);
    await pageA.evaluate(() => window.runMigrationPutPublicDoc!());

    const attachmentOnA = await pageA.evaluate(() => window.runMigrationGetAttachment!());
    expect(attachmentOnA.found).toBe(true);
    expect(attachmentOnA.bytesEqual).toBe(true);
    const ciphertextBefore = await pageB.evaluate(
      async (location) => window.runMigrationPublicGetCiphertext!(location),
      uploaded.location,
    );
    expect(ciphertextBefore.found).toBe(true);
    const publicDocBefore = await pageB.evaluate(
      async (owner) => window.runMigrationGetPublicDoc!(owner),
      signedA.pubky,
    );
    expect(publicDocBefore.found).toBe(true);

    const disable = stagingAdmin("POST", `/users/${signedA.pubky}/disable`);
    const deletedAttachment = stagingAdmin(
      "DELETE",
      `/webdav/${signedA.pubky}${attachmentHomeserverPath(uploaded.location, signedA.pubky)}`,
    );
    const deletedPublic = stagingAdmin(
      "DELETE",
      `/webdav/${signedA.pubky}/pub/hypercolor.app/v1/public-channels/migration-proof.json`,
    );

    const localHistoryOnB = await pageB.evaluate(
      async (peer) => window.runMigrationLocalBodies!(peer),
      signedA.pubky,
    );
    expect(localHistoryOnB).toContain("pre-ban-from-a");

    const attachmentAfterBan = await pageB.evaluate(
      async (location) => window.runMigrationPublicGetCiphertext!(location),
      uploaded.location,
    );
    const publicDocAfterBan = await pageB.evaluate(
      async (owner) => window.runMigrationGetPublicDoc!(owner),
      signedA.pubky,
    );

    const localToken = await mintLocalToken();
    const migrated = await pageA.evaluate(
      async ({ host, token }) => window.runMigrationTo!(host, token),
      { host: localZ32, token: localToken },
    );
    expect(migrated.pubky).toBe(signedA.pubky);

    const postMigrateEnsureA = await pageA.evaluate(
      async (peer) => window.runDmEnsure!(peer),
      signedB.pubky,
    );
    expect(postMigrateEnsureA, "A must not be needs-enable after migrate rebind").not.toBe(
      "needs-enable",
    );

    await pageB.evaluate(async (peer) => window.runMigrationRebindPeer!(peer), signedA.pubky);

    const linkAfterBan = await pageB.evaluate(
      async (peer) => window.runDmEnsure!(peer),
      signedA.pubky,
    );

    let bToAMs: number | null = null;
    let aToBMs: number | null = null;
    let bToAError = "";
    try {
      bToAMs = await pollUntil(
        "B→A after ban+migrate (informational)",
        POST_MIGRATE_LINK_DEADLINE_MS,
        () =>
          sendAndExpectKnownPeer(
            pageB,
            pageA,
            signedA.pubky,
            signedB.pubky,
            `post-ban-from-b-${Date.now()}`,
          ),
      );
    } catch (error) {
      bToAError = error instanceof Error ? error.message : String(error);
    }
    aToBMs = await pollUntil(
      "A→B after ban+migrate (required)",
      POST_MIGRATE_LINK_DEADLINE_MS,
      () =>
        sendAndExpectKnownPeer(
          pageA,
          pageB,
          signedB.pubky,
          signedA.pubky,
          `post-ban-from-a-${Date.now()}`,
        ),
    );

    console.log(
      JSON.stringify({
        scenario: "ban-then-migrate",
        disableStatus: disable.status,
        deleteAttachmentStatus: deletedAttachment.status,
        deletePublicDocStatus: deletedPublic.status,
        localHistoryStillHasPreBan: localHistoryOnB.includes("pre-ban-from-a"),
        attachmentAfterBanFound: attachmentAfterBan.found,
        publicDocAfterBanFound: publicDocAfterBan.found,
        noiseLinkStatusFromB: linkAfterBan,
        bToAMs,
        aToBMs,
        bToAError: bToAError || undefined,
      }),
    );

    expect(migrated.pubky).toBe(signedA.pubky);
    expect(localHistoryOnB).toContain("pre-ban-from-a");
  } finally {
    await browserA.close();
    await browserB.close();
  }
});
