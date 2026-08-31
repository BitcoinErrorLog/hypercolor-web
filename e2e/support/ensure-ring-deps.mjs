#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const vendor = join(root, ".vendor");
const marker = join(vendor, "node_modules", "@synonymdev", "pubky", "package.json");

if (existsSync(marker)) {
  process.exit(0);
}

const result = spawnSync("npm", ["install", "--prefix", vendor, "--no-fund", "--no-audit"], {
  cwd: vendor,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
