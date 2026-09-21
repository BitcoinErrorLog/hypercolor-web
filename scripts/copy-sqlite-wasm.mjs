import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.COPYFILE_DISABLE = "1";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(
  root,
  "node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm",
);
const destDir = join(root, "public");
const dest = join(destDir, "sqlite3.wasm");

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
try {
  rmSync(join(destDir, "._sqlite3.wasm"), { force: true });
} catch {
  // Linux cannot lstat/unlink macOS ExFAT AppleDouble files on a bind mount.
}
console.log(`copied sqlite3.wasm → ${dest}`);
