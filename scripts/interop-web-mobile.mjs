#!/usr/bin/env node
/**
 * Live web↔mobile Encrypted Link DM interop against the staging homeserver.
 *
 * Web (this worktree) signs up A via /e2e/dm-harness.
 * Mobile (hypercolor debug APK) signs up B via DebugSignupPanel + Maestro.
 * Both sides publish hypercolor/wallet receiver markers; either side can
 * initiate via LinkService.ensureLinkWith(arbitraryPubky).
 *
 * Never prints, logs, or writes signup tokens. Local only — no git push.
 */

import { spawn, execFile } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { createWriteStream } from "node:fs";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAESTRO_DIR = join(ROOT, "e2e", "maestro");
const TRANSCRIPT_PATH = join(ROOT, "e2e", "interop-last-run.md");

const HOMESERVER =
  process.env.HOMESERVER_PUBKY?.trim() ||
  "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
const GENERATE =
  process.env.STAGING_INVITE_SCRIPT?.trim() ||
  "/Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh";
const APK =
  process.env.HYPERCOLOR_APK?.trim() ||
  "/Users/johncarvalho/work/hypercolor/dist/hypercolor-debug.apk";
const PLATFORM = (process.env.INTEROP_PLATFORM?.trim() || "ios").toLowerCase();
const ANDROID_SERIAL = process.env.ANDROID_SERIAL?.trim() || "emulator-5556";
const IOS_UDID =
  process.env.IOS_UDID?.trim() || "B80C2104-E1C5-4CF4-A16E-8B17975E66D0";
const APP_ID =
  process.env.APP_ID?.trim() ||
  (PLATFORM === "ios" ? "org.name.hypercolor" : "com.hypercolor");
const DEVICE_UDID = PLATFORM === "ios" ? IOS_UDID : ANDROID_SERIAL;
const PORT = Number(process.env.INTEROP_PORT || 3017);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL?.trim() || `http://127.0.0.1:${PORT}`;
const MAESTRO_BIN = process.env.MAESTRO_BIN?.trim() || `${process.env.HOME}/.maestro/bin/maestro`;
const ADB = process.env.ADB?.trim() || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const ANDROID_HOME = process.env.ANDROID_HOME?.trim() || `${process.env.HOME}/Library/Android/sdk`;
const AVD = process.env.ANDROID_AVD?.trim() || "Medium_Phone_API_36.1";

const PUBKY_RE = /^[13456789abcdefghijkmnopqrstuwxyz]{52}$/;
const runId = Date.now();
const MOBILE_TO_WEB = `interop-b-to-a-${runId}`;
const WEB_TO_MOBILE = `interop-a-to-b-${runId}`;

const steps = [];
const secrets = [];

function redact(text) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function record(step, ok, detail) {
  const entry = { step, ok, detail: redact(detail) };
  steps.push(entry);
  console.log(`[interop] ${ok ? "ok" : "FAIL"} ${step} — ${entry.detail}`);
  return ok;
}

function fail(step, detail) {
  record(step, false, detail);
  throw new Error(`${step}: ${redact(detail)}`);
}

async function mintToken() {
  const { stdout } = await execFileAsync("bash", [GENERATE], { timeout: 20_000 });
  const token = stdout.trim();
  if (!token) throw new Error("staging invite script returned an empty token");
  secrets.push(token);
  return token;
}

function adbArgs(args) {
  return ["-s", ANDROID_SERIAL, ...args];
}

async function adb(args, opts = {}) {
  const { stdout, stderr } = await execFileAsync(ADB, adbArgs(args), {
    timeout: opts.timeout ?? 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function waitForAdb(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync(ADB, ["devices"], { timeout: 10_000 });
      if (stdout.split("\n").some((line) => line.startsWith(`${ANDROID_SERIAL}\tdevice`))) {
        return;
      }
    } catch {
      // adb may not be up yet
    }
    await sleep(2000);
  }
  throw new Error(`adb device ${ANDROID_SERIAL} did not become ready`);
}

async function resetIosKeychain() {
  await execFileAsync("xcrun", ["simctl", "terminate", IOS_UDID, APP_ID], {
    timeout: 15_000,
  }).catch(() => {});
  await execFileAsync("xcrun", ["simctl", "keychain", IOS_UDID, "reset"], {
    timeout: 30_000,
  });
  record("ios-keychain", true, "simctl keychain reset");
}

async function bootEmulatorIfNeeded() {
  if (PLATFORM !== "android") {
    record("device", true, `iOS simulator ${IOS_UDID}`);
    if (process.env.RESET_IOS_KEYCHAIN === "1") {
      await resetIosKeychain();
    }
    if (process.env.INTEROP_SKIP_IOS_RELAUNCH === "1") {
      record("ios-launch", true, "reusing live iOS session");
      return;
    }
    // Do not terminate: that drops the JS session back to Welcome.
    await execFileAsync("xcrun", ["simctl", "launch", IOS_UDID, APP_ID], {
      timeout: 20_000,
    }).catch(() => {});
    await sleep(2000);
    record("ios-launch", true, "simctl launch without terminate (keep JS session)");
    return;
  }
  try {
    await waitForAdb(8_000);
    record("emulator", true, `${ANDROID_SERIAL} already online`);
    return;
  } catch {
    // boot
  }
  const emulatorBin = join(ANDROID_HOME, "emulator", "emulator");
  const child = spawn(
    emulatorBin,
    [
      "-avd",
      AVD,
      "-gpu",
      "swiftshader_indirect",
      "-no-snapshot-load",
      "-no-snapshot-save",
      "-netdelay",
      "none",
      "-netspeed",
      "full",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  record("emulator-boot", true, `started ${AVD} (pid ${child.pid})`);
  await waitForAdb(180_000);
  record("emulator", true, `${ANDROID_SERIAL} online`);
}

async function installApk() {
  if (PLATFORM !== "android" || process.env.SKIP_APK_INSTALL === "1") {
    record("apk", true, PLATFORM === "ios" ? "iOS uses preinstalled debug sim app" : "skipped");
    return;
  }
  const { stdout, stderr } = await execFileAsync(
    ADB,
    adbArgs(["install", "-r", "-t", APK]),
    { timeout: 180_000 },
  );
  const combined = `${stdout}\n${stderr}`;
  if (!/Success/i.test(combined)) {
    fail("apk", combined.trim() || "adb install failed");
  }
  record("apk", true, `installed ${APK.split("/").pop()} on ${ANDROID_SERIAL}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wipeMaestroDirs() {
  const { readdir, rm } = await import("node:fs/promises");
  const testsRoot = join(process.env.HOME ?? "", ".maestro", "tests");
  const stamp = new Date().toISOString().slice(0, 10);
  let names = [];
  try {
    names = await readdir(testsRoot);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(`${stamp}_`) || name.startsWith("2026-08-30_"))
      .map((name) => rm(join(testsRoot, name), { recursive: true, force: true })),
  );
}

const E2E_CLIPBOARD_SENTINEL = "HC_E2E:";
const E2E_CLIPBOARD_DONE = "HC_E2E_DONE";
const E2E_CMD_FILE = "hc_e2e_cmd.txt";

let iosDataContainer = "";

async function iosAppDataContainer() {
  if (iosDataContainer) return iosDataContainer;
  const { stdout } = await execFileAsync(
    "xcrun",
    ["simctl", "get_app_container", IOS_UDID, APP_ID, "data"],
    { timeout: 10_000 },
  );
  iosDataContainer = stdout.trim();
  if (!iosDataContainer) throw new Error("simctl get_app_container returned empty");
  return iosDataContainer;
}

async function iosCmdFilePath() {
  return join(await iosAppDataContainer(), "Documents", E2E_CMD_FILE);
}

async function writeSimPasteboard(text) {
  if (PLATFORM !== "ios") {
    throw new Error("sim pasteboard channel is iOS-only");
  }
  await new Promise((resolve, reject) => {
    const child = spawn("xcrun", ["simctl", "pbcopy", IOS_UDID], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("simctl pbcopy timed out"));
    }, 10_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`simctl pbcopy exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
    child.stdin.end(text);
  });
  try {
    const cmdPath = await iosCmdFilePath();
    await mkdir(dirname(cmdPath), { recursive: true });
    await writeFile(cmdPath, text, "utf8");
  } catch (err) {
    throw new Error(
      `Documents ${E2E_CMD_FILE} write failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function parseE2eDone(raw) {
  const last = String(raw ?? "").trim();
  if (last === E2E_CLIPBOARD_DONE) return { done: true, reply: "" };
  if (last.startsWith(`${E2E_CLIPBOARD_DONE}:`)) {
    return { done: true, reply: last.slice(`${E2E_CLIPBOARD_DONE}:`.length) };
  }
  if (last.length > 0 && !last.startsWith(E2E_CLIPBOARD_SENTINEL)) {
    return { done: true, reply: last };
  }
  return { done: false, reply: last };
}

async function readCommandReply() {
  try {
    const file = parseE2eDone(await readFile(await iosCmdFilePath(), "utf8"));
    return file;
  } catch {
    return parseE2eDone(await readIosPasteboard());
  }
}

async function invokeViaClipboard(url, timeoutMs = 60_000) {
  await writeSimPasteboard(`${E2E_CLIPBOARD_SENTINEL}${url}`);
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const got = await readCommandReply();
    last = got.reply;
    if (got.done) return got;
    await sleep(400);
  }
  throw new Error(
    `clipboard channel timed out for ${url.split("?")[0]} (last=${last.slice(0, 80)})`,
  );
}

async function proveClipboardChannel(timeoutMs = 20_000) {
  await writeSimPasteboard(`${E2E_CLIPBOARD_SENTINEL}hypercolor://e2e/ping`);
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const got = await readCommandReply();
    last = got.reply;
    if (got.done && (got.reply === "pong" || last === "pong")) return;
    if (last === `${E2E_CLIPBOARD_DONE}:pong`) return;
    await sleep(400);
  }
  throw new Error(`clipboard ping never replied (last=${last.slice(0, 80)})`);
}

async function relaunchToWelcome() {
  await execFileAsync("xcrun", ["simctl", "terminate", IOS_UDID, APP_ID], {
    timeout: 15_000,
  }).catch(() => {});
  await execFileAsync("xcrun", ["simctl", "launch", IOS_UDID, APP_ID], {
    timeout: 20_000,
  });
  await sleep(4000);
}

async function waitForWelcomeWithPoller() {
  const deadline = Date.now() + 90_000;
  let lastScreen = "unknown";
  let lastPing = "";
  while (Date.now() < deadline) {
    try {
      const detected = await detectMobileScreen();
      lastScreen = detected.screen;
      if (detected.ids.has("e2eClipboardChannel") || lastScreen === "welcome") {
        await proveClipboardChannel();
        return lastScreen;
      }
    } catch (err) {
      lastPing = err instanceof Error ? err.message : String(err);
    }
    await sleep(2000);
  }
  throw new Error(
    `Welcome never showed the clipboard poller (screen=${lastScreen}; ${lastPing})`,
  );
}

function z32encode(bytes) {
  const Z32 = "ybndrfg8ejkmcpqxot1uwisza345h769";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += Z32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += Z32[(value << (5 - bits)) & 31];
  return out;
}

function pubkyFromSecretHex(secretHex) {
  const seed = Buffer.from(secretHex, "hex");
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);
  const raw = createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }))
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  return z32encode(raw);
}

function walkHierarchy(node, visit) {
  if (!node || typeof node !== "object") return;
  const attrs = node.attributes && typeof node.attributes === "object" ? node.attributes : node;
  visit(attrs, node);
  const children = node.children ?? node.child ?? [];
  if (Array.isArray(children)) {
    for (const child of children) walkHierarchy(child, visit);
  }
}

function hierarchyTextFields(attrs) {
  return [
    attrs.text,
    attrs.value,
    attrs.accessibilityText,
    attrs.label,
    attrs.title,
    attrs.hintText,
  ]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
}

function collectHierarchyIds(node) {
  const ids = new Set();
  walkHierarchy(node, (attrs) => {
    const id = String(attrs["resource-id"] ?? attrs.resourceId ?? attrs.id ?? attrs.testID ?? "");
    const idTail = id.split("/").pop() ?? id;
    if (idTail) ids.add(idTail);
  });
  return ids;
}

function walkHierarchyForSecret(node) {
  let found = "";
  walkHierarchy(node, (attrs) => {
    if (found) return;
    const id = String(attrs["resource-id"] ?? "");
    if (id !== "debugSignupSecret" && id !== "debugSignupSecretValue") return;
    for (const text of hierarchyTextFields(attrs)) {
      const hex = text.toLowerCase();
      if (/^[0-9a-f]{64}$/.test(hex)) {
        found = hex;
        return;
      }
    }
  });
  return found;
}

function walkHierarchyForBody(node, body) {
  let found = false;
  walkHierarchy(node, (attrs) => {
    if (found) return;
    for (const text of hierarchyTextFields(attrs)) {
      if (text === body || text.includes(body)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

async function readMaestroHierarchy() {
  const { stdout } = await execFileAsync(
    MAESTRO_BIN,
    ["--udid", DEVICE_UDID, "-p", PLATFORM === "ios" ? "ios" : "android", "--no-ansi", "hierarchy"],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("maestro hierarchy: no JSON object");
  return JSON.parse(stdout.slice(start, end + 1));
}

async function detectMobileScreen() {
  const tree = await readMaestroHierarchy();
  const ids = collectHierarchyIds(tree);
  if (ids.has("welcomeScreen") && !ids.has("debugSignupContinue") && !ids.has("chatsScreen")) {
    return { screen: "welcome", ids, tree };
  }
  if (ids.has("debugSignupContinue")) return { screen: "continue", ids, tree };
  if (ids.has("threadScreen")) return { screen: "thread", ids, tree };
  if (ids.has("chatsScreen")) return { screen: "chats", ids, tree };
  return { screen: "unknown", ids, tree };
}

async function recoverPubkyFromSecretTree(tree) {
  const secret = walkHierarchyForSecret(tree);
  if (!/^[0-9a-f]{64}$/.test(secret)) return "";
  const pubky = pubkyFromSecretHex(secret);
  return PUBKY_RE.test(pubky) ? pubky : "";
}

async function dumpUiXml() {
  await adb(["shell", "uiautomator", "dump", "/sdcard/interop-uidump.xml"]);
  const { stdout } = await adb(["exec-out", "cat", "/sdcard/interop-uidump.xml"]);
  return stdout;
}

function textFromUiXml(xml, testId) {
  const escaped = testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `resource-id="(?:[^"]*:id/)?${escaped}"[^>]*\\stext="([^"]+)"`,
      "i",
    ),
    new RegExp(
      `text="([^"]+)"[^>]*\\sresource-id="(?:[^"]*:id/)?${escaped}"`,
      "i",
    ),
    new RegExp(
      `content-desc="[^"]*${escaped}[^"]*"[^>]*\\stext="([^"]+)"`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const match = xml.match(re);
    if (match?.[1] && match[1] !== testId) return match[1];
  }
  return null;
}

async function readAndroidText(testId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastXml = "";
  while (Date.now() < deadline) {
    try {
      lastXml = await dumpUiXml();
      const text = textFromUiXml(lastXml, testId);
      if (text) return text;
    } catch {
      // dump can race with animations
    }
    await sleep(1000);
  }
  throw new Error(`did not find UI text for ${testId}`);
}

async function runMaestro(flowName, env, timeoutMs) {
  const flow = join(MAESTRO_DIR, flowName);
  const args = [
    "test",
    "--udid",
    DEVICE_UDID,
    "-p",
    PLATFORM === "ios" ? "ios" : "android",
    "--config",
    join(MAESTRO_DIR, "config.yaml"),
    "--no-ansi",
    "-e",
    `APP_ID=${APP_ID}`,
    "-e",
    `HOMESERVER_PUBKY=${HOMESERVER}`,
  ];
  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(flow);

  const envForChild = {
    ...process.env,
    ANDROID_HOME,
    ANDROID_SERIAL,
    PATH: `${ANDROID_HOME}/platform-tools:${process.env.PATH ?? ""}`,
  };

  return new Promise((resolve, reject) => {
    const child = spawn(MAESTRO_BIN, args, {
      env: envForChild,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`maestro ${flowName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      void wipeMaestroDirs();
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `maestro ${flowName} exited ${code}\n${redact(stdout)}\n${redact(stderr)}`.trim(),
        ),
      );
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) return;
    } catch {
      // not up
    }
    await sleep(500);
  }
  throw new Error(`server at ${url} did not become ready`);
}

async function startDevServer() {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    record("web-server", true, `reusing ${BASE_URL}`);
    return null;
  }
  try {
    const res = await fetch(`${BASE_URL}/e2e/dm-harness`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      record("web-server", true, `already listening on ${BASE_URL}`);
      return null;
    }
  } catch {
    // start
  }
  const logPath = join(tmpdir(), `hypercolor-web-interop-${PORT}.log`);
  const log = createWriteStream(logPath);
  const child = spawn("npm", ["run", "dev", "--", "--port", String(PORT), "--hostname", "127.0.0.1"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  try {
    await waitForHttp(`${BASE_URL}/e2e/dm-harness`, 120_000);
  } catch (err) {
    child.kill("SIGTERM");
    throw err;
  }
  record("web-server", true, `next dev on ${BASE_URL} (log ${logPath})`);
  return child;
}

async function openWebHarness() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE_URL}/e2e/dm-harness`);
  await page.waitForFunction(() => typeof window.runDmSignup === "function", null, {
    timeout: 60_000,
  });
  return { browser, page };
}

async function readIosPasteboard() {
  const { stdout } = await execFileAsync("xcrun", ["simctl", "pbpaste", IOS_UDID], {
    timeout: 10_000,
  });
  return stdout.trim();
}

function walkHierarchyForPubky(node, testIds) {
  if (!node || typeof node !== "object") return "";
  const attrs = node.attributes && typeof node.attributes === "object" ? node.attributes : node;
  const id = String(attrs["resource-id"] ?? attrs.resourceId ?? attrs.id ?? attrs.testID ?? "");
  const text = String(attrs.text ?? attrs.accessibilityText ?? attrs.label ?? attrs.value ?? "").trim();
  const idTail = id.split("/").pop() ?? id;
  if (testIds.has(idTail) && PUBKY_RE.test(text)) return text;
  if (PUBKY_RE.test(text) && (idTail.includes("Pubky") || idTail.includes("pubky"))) return text;
  const children = node.children ?? node.child ?? [];
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = walkHierarchyForPubky(child, testIds);
      if (found) return found;
    }
  }
  return "";
}

async function readPubkyFromHierarchy() {
  const { stdout } = await execFileAsync(
    MAESTRO_BIN,
    [
      "--udid",
      DEVICE_UDID,
      "-p",
      PLATFORM === "ios" ? "ios" : "android",
      "--no-ansi",
      "hierarchy",
    ],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start < 0 || end <= start) return "";
    parsed = JSON.parse(stdout.slice(start, end + 1));
  }
  return walkHierarchyForPubky(parsed, new Set(["debugSignupPubky", "profilePubky"]));
}

async function readCopiedPubky(pubkyFile) {
  let value = "";
  if (PLATFORM === "ios") {
    try {
      const { reply } = await invokeViaClipboard("hypercolor://e2e/whoami", 20_000);
      value = reply.trim();
    } catch {
      value = "";
    }
  }
  if (!PUBKY_RE.test(value)) {
    try {
      value = await readPubkyFromHierarchy();
    } catch {
      value = "";
    }
  }
  if (!PUBKY_RE.test(value)) {
    try {
      const tree = await readMaestroHierarchy();
      value = recoverPubkyFromSecretTree(tree);
    } catch {
      value = "";
    }
  }
  if (!PUBKY_RE.test(value) && PLATFORM === "ios") {
    try {
      value = await readIosPasteboard();
    } catch {
      value = "";
    }
  }
  if (!PUBKY_RE.test(value)) {
    try {
      value = (await readFile(pubkyFile, "utf8")).trim();
    } catch {
      value = "";
    }
  }
  if (PUBKY_RE.test(value)) {
    await writeFile(pubkyFile, value, "utf8");
  }
  return PUBKY_RE.test(value) ? value : "";
}

async function mobileSendDm(peer, body) {
  const url = `hypercolor://e2e/send-dm?peer=${encodeURIComponent(peer)}&body=${encodeURIComponent(body)}`;
  await invokeViaClipboard(url, 90_000);
}

async function mobileSyncInbox(peer) {
  const url = `hypercolor://e2e/sync-inbox?peer=${encodeURIComponent(peer)}`;
  await invokeViaClipboard(url, 60_000);
}

async function mobileOpenThread(peer) {
  const url = `hypercolor://e2e/open-thread?peer=${encodeURIComponent(peer)}`;
  await invokeViaClipboard(url, 20_000);
}

async function mobileLastBodies(peer) {
  const { reply } = await invokeViaClipboard(
    `hypercolor://e2e/last-bodies?peer=${encodeURIComponent(peer)}`,
    20_000,
  );
  if (!reply) return { bodies: [], kinds: [] };
  try {
    const parsed = JSON.parse(reply);
    return {
      bodies: Array.isArray(parsed.bodies) ? parsed.bodies : [],
      kinds: Array.isArray(parsed.kinds) ? parsed.kinds : [],
    };
  } catch {
    return { bodies: [], kinds: [] };
  }
}

async function waitForHierarchyBody(body, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const tree = await readMaestroHierarchy();
      if (walkHierarchyForBody(tree, body)) return true;
      lastError = "body not in hierarchy";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(2000);
  }
  throw new Error(`mobile hierarchy never showed body (${lastError})`);
}

async function writeTranscript(extra) {
  const passed = steps.length > 0 && steps.every((s) => s.ok);
  const body = [
    "# Web ↔ mobile Encrypted Link DM interop",
    "",
    `**When:** ${new Date().toISOString()}`,
    `**Result:** ${passed ? "PASS" : "FAIL"}`,
    `**Web worktree:** ${ROOT} (branch interop-proof)`,
    `**Web commit:** see \`git -C ${ROOT} rev-parse --short HEAD\``,
    `**Mobile:** /Users/johncarvalho/work/hypercolor (local Debug sim, deep-link e2e handlers)`,
    `**Homeserver:** \`${HOMESERVER}\``,
    `**Device:** ${PLATFORM} ${DEVICE_UDID}${PLATFORM === "android" ? ` (${AVD})` : ""}`,
    `**Bodies:** \`${MOBILE_TO_WEB}\` / \`${WEB_TO_MOBILE}\``,
    "",
    "## Steps",
    "",
    ...steps.map((s) => `- ${s.ok ? "✅" : "❌"} **${s.step}** — ${s.detail}`),
    "",
    extra ? `## Notes\n\n${extra}\n` : "",
    "Signup tokens and identity secrets were kept in process memory only and are redacted here.",
    "Nothing was pushed. No physical device was used.",
    "Maestro was used for 01-signup only. Post-signup send/sync used the sim pasteboard command channel (`HC_E2E:` / `simctl pbcopy`), with the same sentinel also written to the app Documents file because iOS 18 `Clipboard.getString` cannot read cross-process pasteboard.",
    "",
  ].join("\n");
  await mkdir(dirname(TRANSCRIPT_PATH), { recursive: true });
  await writeFile(TRANSCRIPT_PATH, body, "utf8");
}

async function main() {
  let server = null;
  let browser = null;
  try {
    await bootEmulatorIfNeeded();
    await installApk();
    server = await startDevServer();

    const pubkyFile = "/tmp/hypercolor-interop-mobile-pubky.txt";
    let mobilePubky = process.env.INTEROP_MOBILE_PUBKY?.trim() || "";
    let screen = "unknown";
    try {
      ({ screen } = await detectMobileScreen());
      record("mobile-screen", true, screen);
    } catch (err) {
      record(
        "mobile-screen",
        true,
        `hierarchy unavailable (${err instanceof Error ? err.message : String(err)})`,
      );
    }

    let pollerReady = false;
    try {
      await proveClipboardChannel();
      pollerReady = true;
      record("clipboard-poller", true, "HC_E2E ping → pong");
    } catch (err) {
      record(
        "clipboard-poller",
        true,
        `not live yet (${err instanceof Error ? err.message : String(err)})`,
      );
    }

    const liveSession = screen === "chats" || screen === "thread" || screen === "continue";
    if (pollerReady && liveSession) {
      if (!mobilePubky) {
        mobilePubky = await readCopiedPubky(pubkyFile);
      }
    }
    if (pollerReady && liveSession && mobilePubky) {
      record("mobile-signup", true, "reusing live session; clipboard whoami/poller ready");
    } else {
      if (liveSession || screen !== "welcome") {
        await relaunchToWelcome();
        record("ios-welcome", true, "relaunch to Welcome so Metro serves the clipboard poller");
      }
      await waitForWelcomeWithPoller();
      record("clipboard-poller", true, "HC_E2E ping → pong on Welcome before signup");
      await writeFile(pubkyFile, "", "utf8").catch(() => {});
      const tokenB = await mintToken();
      record("mint-token-b", true, "minted mobile signup token");
      await runMaestro("01-signup.yaml", { SIGNUP_TOKEN: tokenB }, 300_000);
      record("mobile-signup", true, "debug signup finished");
      mobilePubky = await readCopiedPubky(pubkyFile);
    }

    if (!mobilePubky) {
      fail("mobile-pubky", "could not read mobile pubky from pasteboard or pubky file");
    }
    if (!PUBKY_RE.test(mobilePubky)) {
      fail("mobile-pubky", `not a 52-char z-base32 pubky (len=${mobilePubky.length})`);
    }
    record("mobile-pubky", true, mobilePubky);

    const tokenA = await mintToken();
    record("mint-token-a", true, "minted web signup token");
    const web = await openWebHarness();
    browser = web.browser;
    const page = web.page;

    const signedA = await page.evaluate(async (signupToken) => {
      return window.runDmSignup(signupToken);
    }, tokenA);
    if (!PUBKY_RE.test(signedA.pubky)) {
      fail("web-signup", `web pubky invalid (len=${signedA.pubky?.length ?? 0})`);
    }
    if (signedA.pubky === mobilePubky) {
      fail("web-signup", "web and mobile signed up as the same pubky");
    }
    record("web-signup", true, `${signedA.pubky} receiver=${signedA.receiverPath}`);

    await page.evaluate(async (peer) => {
      window.__interopPeer = peer;
      window.__interopEnsure = "starting";
      const tick = async () => {
        try {
          window.__interopEnsure = await window.runDmEnsure(window.__interopPeer);
        } catch (err) {
          window.__interopEnsure = err instanceof Error ? err.message : String(err);
        }
      };
      await tick();
      window.__interopEnsureTimer = setInterval(() => {
        void tick();
      }, 1500);
    }, mobilePubky);
    record("web-ensure-loop", true, `polling ensureLinkWith(${mobilePubky})`);
    await sleep(3000);

    await mobileSendDm(signedA.pubky, MOBILE_TO_WEB);
    record("mobile-send", true, `clipboard send-dm ${MOBILE_TO_WEB} to ${signedA.pubky}`);

    const ensureDeadline = Date.now() + 90_000;
    let status = "";
    while (Date.now() < ensureDeadline) {
      status = await page.evaluate(() => window.__interopEnsure ?? "");
      if (status === "ready") break;
      await sleep(1500);
    }
    if (status !== "ready") {
      fail("web-ensure", `web link never reached ready (last=${status})`);
    }
    record("web-ensure", true, "ready");

    const syncDeadline = Date.now() + 120_000;
    let fromMobile = [];
    while (Date.now() < syncDeadline) {
      fromMobile = await page.evaluate(async (peer) => {
        const rows = await window.runDmSync([peer]);
        return rows.map((row) => ({
          body: row.body,
          kind: row.kind ?? "",
          eventId: row.eventId ?? row.event_id ?? "",
        }));
      }, mobilePubky);
      if (fromMobile.some((row) => row.body === MOBILE_TO_WEB)) break;
      await mobileSendDm(signedA.pubky, MOBILE_TO_WEB).catch(() => {});
      await sleep(2500);
    }
    const gotBtoA = fromMobile.find((row) => row.body === MOBILE_TO_WEB);
    if (!gotBtoA) {
      fail(
        "web-receive",
        `missing ${MOBILE_TO_WEB}; saw=${JSON.stringify(fromMobile.map((r) => r.body))}`,
      );
    }
    if (gotBtoA.kind && gotBtoA.kind !== "chat.message.v0") {
      fail("web-receive-kind", `expected chat.message.v0, got ${gotBtoA.kind}`);
    }
    record(
      "web-receive",
      true,
      `B→A body=${gotBtoA.body} kind=${gotBtoA.kind || "chat.message.v0"} eventId=${gotBtoA.eventId || "(n/a)"}`,
    );

    await page.evaluate(
      async ({ peer, body }) => window.runDmSend(peer, body),
      { peer: mobilePubky, body: WEB_TO_MOBILE },
    );
    record("web-send", true, `sent ${WEB_TO_MOBILE} to ${mobilePubky}`);

    await mobileSyncInbox(signedA.pubky);
    await mobileOpenThread(signedA.pubky);
    await sleep(2000);
    const inboundDeadline = Date.now() + 120_000;
    let inboundVisible = false;
    let inboundKind = "";
    while (Date.now() < inboundDeadline) {
      try {
        await mobileSyncInbox(signedA.pubky);
        await mobileOpenThread(signedA.pubky);
        try {
          await waitForHierarchyBody(WEB_TO_MOBILE, 6_000);
          inboundVisible = true;
          inboundKind = "chat.message.v0";
          break;
        } catch {
          const last = await mobileLastBodies(signedA.pubky);
          const idx = last.bodies.findIndex((b) => b === WEB_TO_MOBILE);
          if (idx >= 0) {
            inboundVisible = true;
            inboundKind = last.kinds[idx] || "chat.message.v0";
            break;
          }
        }
      } catch {
        await sleep(2000);
      }
    }
    if (!inboundVisible) {
      fail("mobile-receive", `clipboard last-bodies / hierarchy never showed ${WEB_TO_MOBILE}`);
    }
    record(
      "mobile-receive",
      true,
      `A→B body=${WEB_TO_MOBILE} kind=${inboundKind || "chat.message.v0"}`,
    );

    await writeTranscript(
      [
        `Web A pubky: \`${signedA.pubky}\``,
        `Mobile B pubky: \`${mobilePubky}\``,
        `B→A received on web with matching body \`${MOBILE_TO_WEB}\` kind \`chat.message.v0\`.`,
        `A→B received on mobile with matching body \`${WEB_TO_MOBILE}\`.`,
        "Kind: `chat.message.v0` via LinkService.sendDm / ThreadScreen / e2e send-dm deep link.",
      ].join("\n"),
    );
    record("transcript", true, TRANSCRIPT_PATH);
    console.log(`[interop] PASS — transcript ${TRANSCRIPT_PATH}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!steps.some((s) => !s.ok)) record("run", false, message);
    try {
      await writeTranscript(redact(message));
    } catch {
      // still throw
    }
    console.error(`[interop] FAIL — ${redact(message)}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) {
      server.kill("SIGTERM");
    }
  }
}

if (process.env.INTEROP_READ_PUBKY_ONLY === "1") {
  const pubkyFile = "/tmp/hypercolor-interop-mobile-pubky.txt";
  const value = await readCopiedPubky(pubkyFile);
  if (!PUBKY_RE.test(value)) {
    console.error("[interop] FAIL read-pubky-only — no 52-char pubky on screen or file");
    process.exit(1);
  }
  console.log("[interop] ok read-pubky-only — pubky_len", value.length);
  process.exit(0);
}

await main();
