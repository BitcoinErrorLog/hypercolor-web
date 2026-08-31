#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  LOCAL_APP,
  LOCAL_NEXT_DIST,
  prepareNextDistDir,
  watchAndRepairNextJson,
} from "./prepare-next-distdir.mjs";

prepareNextDistDir();
watchAndRepairNextJson(LOCAL_NEXT_DIST);

const port = process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1]
  : "3000";

const env = { ...process.env, COPYFILE_DISABLE: "1" };
delete env.NEXT_DIST_DIR;

const child = spawn("npm", ["run", "dev", "--", "--port", port], {
  cwd: LOCAL_APP,
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
