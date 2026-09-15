import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(
  root,
  "node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm",
);
const destDir = join(root, "public");
const dest = join(destDir, "sqlite3.wasm");

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`copied sqlite3.wasm → ${dest}`);
