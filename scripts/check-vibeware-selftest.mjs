#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY = path.join(ROOT, "scripts/check-vibeware-path-policy");
const MANIFEST = path.join(ROOT, "vibeware.yaml");

function writeList(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "vibeware-"));
  const listPath = path.join(dir, "changed-files");
  writeFileSync(listPath, `${files.join("\n")}\n`);
  return listPath;
}

function run(surface, files) {
  const listPath = writeList(files);
  return spawnSync(POLICY, ["--manifest", MANIFEST, "--surface", surface, "--changed-files", listPath], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function rejectSet(result) {
  return new Set(
    (result.stderr || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

const cases = [
  {
    name: "accepts chats-page.tsx for hc-chats-ui",
    surface: "hc-chats-ui",
    files: ["src/components/chats-page.tsx"],
    expectStatus: 0,
    expectRejected: [],
  },
  {
    name: "rejects session.ts for hc-chats-ui",
    surface: "hc-chats-ui",
    files: ["src/services/link/session.ts"],
    expectStatus: 1,
    expectRejected: ["src/services/link/session.ts"],
  },
  {
    name: "rejects chats-page.tsx plus session.ts",
    surface: "hc-chats-ui",
    files: ["src/components/chats-page.tsx", "src/services/link/session.ts"],
    expectStatus: 1,
    expectRejected: ["src/services/link/session.ts"],
  },
  {
    name: "rejects a change to vibeware.yaml",
    surface: "hc-chats-ui",
    files: ["vibeware.yaml"],
    expectStatus: 1,
    expectRejected: ["vibeware.yaml"],
  },
  {
    name: "rejects attachment-bubble.tsx for hc-thread-ui",
    surface: "hc-thread-ui",
    files: ["src/components/attachment-bubble.tsx"],
    expectStatus: 1,
    expectRejected: ["src/components/attachment-bubble.tsx"],
  },
  {
    name: "empty change set exits 0",
    surface: "hc-chats-ui",
    files: [],
    expectStatus: 0,
    expectRejected: [],
  },
];

let failed = 0;
for (const testCase of cases) {
  const result = run(testCase.surface, testCase.files);
  const rejected = rejectSet(result);
  const statusOk = result.status === testCase.expectStatus;
  const rejectedOk = testCase.expectRejected.every((filePath) => rejected.has(filePath));
  const extra = [...rejected].filter((filePath) => !testCase.expectRejected.includes(filePath));
  if (!statusOk || !rejectedOk || extra.length > 0) {
    failed += 1;
    console.error(`FAIL ${testCase.name}`);
    console.error(`  status ${result.status} (expected ${testCase.expectStatus})`);
    console.error(`  stderr: ${(result.stderr || "").trim()}`);
    if (result.error) console.error(`  spawn: ${result.error.message}`);
  } else {
    console.log(`ok ${testCase.name}`);
  }
}

try {
  const emptyFile = writeList([]);
  const empty = spawnSync(
    POLICY,
    ["--manifest", MANIFEST, "--surface", "hc-chats-ui", "--changed-files", emptyFile],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert(empty.status === 0, `empty list file must exit 0, got ${empty.status}`);
  console.log("ok empty list file exits 0");
} catch (error) {
  failed += 1;
  console.error(`FAIL empty list file exits 0: ${error instanceof Error ? error.message : error}`);
}

if (failed > 0) {
  console.error(`check:vibeware failed (${failed})`);
  process.exit(1);
}
console.log("check:vibeware passed");
