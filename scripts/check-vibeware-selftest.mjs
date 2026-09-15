#!/usr/bin/env node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertCiPrGateOrder,
  evaluateChangedFiles,
  loadManifest,
  loadManifestFile,
} from "./check-vibeware-path-policy.mjs";
import { validateEvidencePayload } from "./vibeware-evidence.mjs";
import { checkWritableImports, scanWritableFile } from "./check-vibeware-writable-imports.mjs";

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
  {
    name: "rejects package.json as forbidden",
    surface: "hc-chats-ui",
    files: ["package.json"],
    expectStatus: 1,
    expectRejected: [{ path: "package.json", reason: "forbidden" }],
  },
  {
    name: "rejects useInbox.ts as forbidden",
    surface: "hc-chats-ui",
    files: ["src/hooks/useInbox.ts"],
    expectStatus: 1,
    expectRejected: [{ path: "src/hooks/useInbox.ts", reason: "forbidden" }],
  },
  {
    name: "rejects copy-sqlite-wasm.mjs as forbidden",
    surface: "hc-chats-ui",
    files: ["scripts/copy-sqlite-wasm.mjs"],
    expectStatus: 1,
    expectRejected: [{ path: "scripts/copy-sqlite-wasm.mjs", reason: "forbidden" }],
  },
  {
    name: "rejects addManualContact.ts as forbidden",
    surface: "hc-chats-ui",
    files: ["src/services/contacts/addManualContact.ts"],
    expectStatus: 1,
    expectRejected: [{ path: "src/services/contacts/addManualContact.ts", reason: "forbidden" }],
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
  const schemaSrc = readFileSync(path.join(ROOT, "src/services/vibeware/schema.ts"), "utf8");
  assert(
    schemaSrc.includes('from "../../../scripts/vibeware-evidence.mjs"'),
    "schema.ts must re-export scripts/vibeware-evidence.mjs",
  );
  assert(
    !/function validateEvidencePayload/.test(schemaSrc),
    "schema.ts must not define its own validateEvidencePayload",
  );
  console.log("ok schema.ts re-exports the P0 validator");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL schema.ts re-export: ${error instanceof Error ? error.message : error}`,
  );
}

try {
  const planted = validateEvidencePayload("app.thread.send_settled", {
    channel: "dm",
    outcome: "sent",
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
  const secretRoute = validateEvidencePayload("app.route.viewed", {
    route: "secret message",
    from_route: "none",
  });
  assert(secretRoute.ok === false, "route secret message must fail");
  assert(secretRoute.reason === "invalid_value", "route secret message must be invalid_value");
  console.log("ok route secret message fails validator");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL route secret message: ${error instanceof Error ? error.message : error}`,
  );
}

try {
  const nested = validateEvidencePayload("app.pwa.installed", {
    outcome: { accepted: true },
  });
  assert(nested.ok === false, "nested object payload must fail");
  assert(nested.reason === "nested_value", "nested object must be nested_value");
  console.log("ok nested object payload fails validator");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL nested object payload: ${error instanceof Error ? error.message : error}`,
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

try {
  const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assertCiPrGateOrder(ci);
  const gateAt = ci.indexOf("check-vibeware-pr.mjs");
  const npmCiAt = ci.search(/run:\s*npm ci\b/);
  assert(gateAt >= 0 && npmCiAt >= 0 && gateAt < npmCiAt, "PR gate step must appear before npm ci");
  console.log("ok CI PR gate appears before npm ci");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL CI PR gate order: ${error instanceof Error ? error.message : error}`,
  );
}

try {
  const requireInbox = scanWritableFile(
    `const { useInbox } = require("@/hooks/useInbox");\n`,
    "src/components/chats-page.tsx",
    ["src/hooks/useInbox.ts"],
  );
  assert(
    requireInbox.some((item) => item.reason === "forbidden_import"),
    "require() of useInbox must be forbidden_import",
  );
  const commentedDynamic = scanWritableFile(
    `await import(/* comment */ "@/hooks/useInbox");\n`,
    "src/components/chats-page.tsx",
    ["src/hooks/useInbox.ts"],
  );
  assert(
    commentedDynamic.some((item) => item.reason === "forbidden_import"),
    "commented dynamic import of useInbox must be forbidden_import",
  );
  const manualContact = scanWritableFile(
    `import { addManualContact } from "@/services/contacts/addManualContact";\n`,
    "src/components/chats-page.tsx",
    ["src/services/contacts/addManualContact.ts"],
  );
  assert(
    manualContact.some((item) => item.reason === "forbidden_import"),
    "writable import of addManualContact must be forbidden_import",
  );
  console.log("ok require/commented-dynamic/addManualContact import bans");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL specifier import bans: ${error instanceof Error ? error.message : error}`,
  );
}

function git(cwd, args, allowFail = false) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0 && !allowFail) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

try {
  const fake = mkdtempSync(path.join(tmpdir(), "vibeware-f2-"));
  git(fake, ["init"]);
  git(fake, ["config", "user.email", "vibeware@test"]);
  git(fake, ["config", "user.name", "vibeware"]);
  git(fake, ["config", "commit.gpgsign", "false"]);
  mkdirSync(path.join(fake, "scripts"), { recursive: true });
  mkdirSync(path.join(fake, "src/services/link"), { recursive: true });
  copyFileSync(MANIFEST, path.join(fake, "vibeware.yaml"));
  writeFileSync(path.join(fake, "scripts/check-vibeware-pr.mjs"), "console.log('honest');\n");
  writeFileSync(path.join(fake, "src/services/link/session.ts"), "export {}\n");
  git(fake, ["add", "-A"]);
  git(fake, ["commit", "-m", "base"]);
  const baseSha = git(fake, ["rev-parse", "HEAD"]).stdout.trim();
  git(fake, ["checkout", "-b", "vibeware/probe"]);
  mkdirSync(path.join(fake, ".vibeware"), { recursive: true });
  writeFileSync(path.join(fake, ".vibeware/candidate"), "surface: hc-chats-ui\n");
  writeFileSync(path.join(fake, "scripts/check-vibeware-pr.mjs"), "process.exit(0);\n");
  writeFileSync(path.join(fake, "src/services/link/session.ts"), "export const pwned = true;\n");
  git(fake, ["add", "-A"]);
  git(fake, ["commit", "-m", "rewrite evaluator and session"]);
  const headSha = git(fake, ["rev-parse", "HEAD"]).stdout.trim();

  const candidateRun = spawnSync(
    process.execPath,
    [
      path.join(fake, "scripts/check-vibeware-pr.mjs"),
      "--repo",
      fake,
      "--base",
      baseSha,
      "--head",
      headSha,
      "--head-ref",
      "vibeware/probe",
    ],
    { encoding: "utf8" },
  );
  assert(candidateRun.status === 0, `candidate rewrite must exit 0, got ${candidateRun.status}`);

  const honest = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/check-vibeware-pr.mjs"),
      "--repo",
      fake,
      "--base",
      baseSha,
      "--head",
      headSha,
      "--head-ref",
      "vibeware/probe",
    ],
    { encoding: "utf8" },
  );
  assert(honest.status === 1, `honest evaluator must reject, got ${honest.status}`);
  const rejected = (honest.stderr || "").split(/\r?\n/).filter(Boolean);
  assert(
    rejected.some((line) => line.startsWith("scripts/check-vibeware-pr.mjs\tforbidden")),
    `honest run must reject rewritten evaluator: ${honest.stderr}`,
  );
  assert(
    rejected.some((line) => line.startsWith("src/services/link/session.ts\tforbidden")),
    `honest run must reject session.ts: ${honest.stderr}`,
  );
  console.log("ok rewritten evaluator still rejected by base copy");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL rewritten evaluator still rejected by base copy: ${error instanceof Error ? error.message : error}`,
  );
}

try {
  const fixturePath = path.join(ROOT, "fixtures/vibeware/empty-state-problem.json");
  const problem = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert(problem.status === "qualified", "empty-state fixture must be qualified");
  assert(
    Array.isArray(problem.evidence_refs) &&
      problem.evidence_refs.every((ref) => /^ev_[a-z0-9_]+$/.test(ref)),
    "empty-state fixture evidence_refs must be fake ev_ ids",
  );
  assert(problem.problem?.target_file === "src/components/chats-page.tsx", "fixture target");
  const chats = readFileSync(path.join(ROOT, "src/components/chats-page.tsx"), "utf8");
  assert(chats.includes(problem.problem.find), "main chats-page must still have the unpatched find string");
  assert(!chats.includes(problem.problem.replace) || problem.problem.find === problem.problem.replace, "main must not keep the fixture replace string");
  const sandboxOk = run("hc-chats-ui", [problem.problem.target_file]);
  assert(sandboxOk.status === 0, "fixture target must be writable for hc-chats-ui");
  const sandboxProbe = run("hc-chats-ui", ["src/services/link/session.ts"]);
  assert(sandboxProbe.status === 1, "session probe must fail path-policy");
  assert(
    rejectMap(sandboxProbe).get("src/services/link/session.ts") === "forbidden",
    "session probe must be forbidden",
  );
  console.log("ok sandbox fixture stays off main and session probe is forbidden");
} catch (error) {
  failed += 1;
  console.error(
    `FAIL sandbox fixture: ${error instanceof Error ? error.message : error}`,
  );
}

if (failed > 0) {
  console.error(`check:vibeware failed (${failed})`);
  process.exit(1);
}
console.log("check:vibeware passed");
