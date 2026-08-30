#!/usr/bin/env node
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  evaluateChangedFiles,
  loadManifest,
  loadManifestFile,
} from "./check-vibeware-path-policy.mjs";
import { validateEvidencePayload } from "./vibeware-evidence.mjs";
import { checkWritableImports } from "./check-vibeware-writable-imports.mjs";

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

function rejectMap(result) {
  const out = new Map();
  for (const line of (result.stderr || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [filePath, reason] = trimmed.split("\t");
    out.set(filePath, reason || "");
  }
  return out;
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
    name: "rejects session.ts for hc-chats-ui as forbidden",
    surface: "hc-chats-ui",
    files: ["src/services/link/session.ts"],
    expectStatus: 1,
    expectRejected: [{ path: "src/services/link/session.ts", reason: "forbidden" }],
  },
  {
    name: "rejects chats-page.tsx plus session.ts",
    surface: "hc-chats-ui",
    files: ["src/components/chats-page.tsx", "src/services/link/session.ts"],
    expectStatus: 1,
    expectRejected: [{ path: "src/services/link/session.ts", reason: "forbidden" }],
  },
  {
    name: "rejects a change to vibeware.yaml as forbidden",
    surface: "hc-chats-ui",
    files: ["vibeware.yaml"],
    expectStatus: 1,
    expectRejected: [{ path: "vibeware.yaml", reason: "forbidden" }],
  },
  {
    name: "rejects a candidate rewrite of the evaluator as forbidden",
    surface: "hc-chats-ui",
    files: ["scripts/check-vibeware-path-policy.mjs"],
    expectStatus: 1,
    expectRejected: [{ path: "scripts/check-vibeware-path-policy.mjs", reason: "forbidden" }],
  },
  {
    name: "rejects .github/workflows/ci.yml as forbidden",
    surface: "hc-chats-ui",
    files: [".github/workflows/ci.yml"],
    expectStatus: 1,
    expectRejected: [{ path: ".github/workflows/ci.yml", reason: "forbidden" }],
  },
  {
    name: "rejects README.md as outside_writable",
    surface: "hc-chats-ui",
    files: ["README.md"],
    expectStatus: 1,
    expectRejected: [{ path: "README.md", reason: "outside_writable" }],
  },
  {
    name: "rejects attachment-bubble.tsx for hc-thread-ui as forbidden",
    surface: "hc-thread-ui",
    files: ["src/components/attachment-bubble.tsx"],
    expectStatus: 1,
    expectRejected: [{ path: "src/components/attachment-bubble.tsx", reason: "forbidden" }],
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
  const rejected = rejectMap(result);
  const statusOk = result.status === testCase.expectStatus;
  const rejectedOk = testCase.expectRejected.every(
    (item) => rejected.get(item.path) === item.reason,
  );
  const extra = [...rejected.keys()].filter(
    (filePath) => !testCase.expectRejected.some((item) => item.path === filePath),
  );
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

try {
  const emptied = readFileSync(MANIFEST, "utf8").replace(
    /^forbidden_paths:\n(?: {2}- .+\n)+/m,
    "forbidden_paths: []\n",
  );
  let threw = false;
  try {
    loadManifest(emptied);
  } catch (error) {
    threw = /forbidden_paths/.test(error instanceof Error ? error.message : "");
  }
  assert(threw, "emptied forbidden_paths must fail load");
  console.log("ok emptied forbidden_paths fails load");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL emptied forbidden_paths fails load: ${error instanceof Error ? error.message : error}`,
  );
}

try {
  const manifest = loadManifestFile(MANIFEST);
  const chats = manifest.surfaces.find((surface) => surface.id === "hc-chats-ui");
  const widened = {
    ...manifest,
    surfaces: [{ ...chats, writable_paths: ["src/**"] }],
  };
  const result = evaluateChangedFiles(widened, "hc-chats-ui", ["src/services/KeyStore.ts"]);
  assert(result.ok === false, "widened src/** must still reject KeyStore.ts");
  assert(result.rejected[0]?.reason === "forbidden", "KeyStore.ts must reject as forbidden");
  console.log("ok writable glob src/** + KeyStore.ts rejects as forbidden");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL writable glob KeyStore: ${error instanceof Error ? error.message : error}`,
  );
}

try {
  const planted = validateEvidencePayload("app.thread.send_settled", {
    channel: "dm",
    outcome: "ok",
    kind: "text",
    body: "hi",
  });
  assert(planted.ok === false, "planted body payload must fail");
  console.log("ok planted body payload fails validator");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL planted body payload: ${error instanceof Error ? error.message : error}`,
  );
}

try {
  const imports = checkWritableImports();
  assert(imports.ok, `writable-import check failed: ${JSON.stringify(imports.findings)}`);
  console.log("ok writable-import check");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL writable-import check: ${error instanceof Error ? error.message : error}`,
  );
}

if (failed > 0) {
  console.error(`check:vibeware failed (${failed})`);
  process.exit(1);
}
console.log("check:vibeware passed");
