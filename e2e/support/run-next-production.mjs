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
  : "3010";

const env = { ...process.env, COPYFILE_DISABLE: "1" };
delete env.NEXT_DIST_DIR;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: LOCAL_APP, stdio: "inherit", env });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code ?? 1}`));
    });
  });
}

await run("npm", ["run", "build"]);
const child = spawn(
  "npx",
  ["--yes", "serve", "out", "-p", port, "--no-port-switching"],
  {
    cwd: LOCAL_APP,
    stdio: "inherit",
    env,
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
