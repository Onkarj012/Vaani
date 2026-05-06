const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const currentPid = process.pid;
const parentPid = process.ppid;
const singletonArtifacts = [
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket"
];

function looksLikeWorkspaceDevProcess(command) {
  if (!command.includes(projectRoot)) {
    return false;
  }

  return [
    "electron-forge start",
    "node_modules/.bin/electron-forge",
    "node_modules/electron/cli.js",
    ".vite/build/main.js",
    "/Electron.app/Contents/MacOS/Electron",
    "vite"
  ].some((needle) => command.includes(needle));
}

function listStalePids() {
  const ps = spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  if (ps.status !== 0) {
    if (ps.stderr) {
      process.stderr.write(ps.stderr);
    }
    return [];
  }

  return ps.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }

      const pid = Number(match[1]);
      const ppid = Number(match[2]);
      const command = match[3];

      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
        return null;
      }

      return { pid, ppid, command };
    })
    .filter((entry) => entry && entry.pid !== currentPid && entry.pid !== parentPid)
    .filter((entry) => entry.ppid !== currentPid && entry.ppid !== parentPid)
    .filter((entry) => looksLikeWorkspaceDevProcess(entry.command))
    .map((entry) => entry.pid);
}

function terminatePid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function cleanupStaleProcesses() {
  const stalePids = listStalePids();
  if (stalePids.length === 0) {
    return;
  }

  for (const pid of stalePids) {
    terminatePid(pid, "SIGTERM");
  }

  sleep(750);

  for (const pid of stalePids) {
    if (processExists(pid)) {
      terminatePid(pid, "SIGKILL");
    }
  }
}

function cleanupSingletonArtifacts() {
  for (const artifact of singletonArtifacts) {
    const artifactPath = path.join(projectRoot, artifact);
    try {
      fs.rmSync(artifactPath, { force: true, recursive: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

cleanupStaleProcesses();
cleanupSingletonArtifacts();

const child = spawn("npx", ["electron-forge", "start"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
