#!/usr/bin/env node
import { readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extractStoredZip } from "./zip-store.mjs";
import {
  RUNTIME_ARCHIVE_ROOT,
  RUNTIME_MANIFEST_NAME,
  RUNTIME_PACKAGE_PATH
} from "./runtime-package-rules.mjs";

const root = process.cwd();
const npmCommand = process.env.npm_execpath === undefined
  ? { command: process.platform === "win32" ? "npm.cmd" : "npm", prefixArgs: [] }
  : { command: process.execPath, prefixArgs: [process.env.npm_execpath] };

function runCommand(commandSpec, args) {
  const finalArgs = [...commandSpec.prefixArgs, ...args];
  const result = spawnSync(commandSpec.command, finalArgs, {
    cwd: root,
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    const reason = result.error instanceof Error ? ` (${result.error.message})` : "";
    throw new Error(
      `Command failed: ${commandSpec.command} ${finalArgs.join(" ")}${reason}`
    );
  }
}

async function waitForUrl(url, attempts = 80) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function stopProcessTree(processId) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(processId), "/T", "/F"], {
      stdio: "ignore",
      shell: false
    });
    return;
  }

  try {
    process.kill(-processId, "SIGTERM");
  } catch {
    try {
      process.kill(processId, "SIGTERM");
    } catch {
      // Process may already be gone.
    }
  }
}

function parseSelectedPort(logText) {
  const match = logText.match(/selected port: 127\.0\.0\.1:(\d+)/u);
  if (!match) {
    throw new Error("Runtime log does not include the selected loopback port");
  }

  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 17817 || port > 17880) {
    throw new Error(`Runtime selected port outside 17817-17880: ${port}`);
  }

  return port;
}

async function main() {
  runCommand(npmCommand, ["run", "package:runtime"]);
  runCommand(npmCommand, ["run", "audit:runtime"]);

  const tempDirectory = await mkdtemp(join(tmpdir(), "aleksi-runtime-verify-"));
  const extractedDirectory = join(tempDirectory, "runtime");
  let runtimeProcessId;

  try {
    await extractStoredZip(resolve(root, RUNTIME_PACKAGE_PATH), extractedDirectory);

    const runtimeRoot = join(extractedDirectory, RUNTIME_ARCHIVE_ROOT);
    const manifest = JSON.parse(
      await readFile(join(runtimeRoot, RUNTIME_MANIFEST_NAME), "utf8")
    );
    const expiredDateLog = join(runtimeRoot, "logs/2000-01-01.log");
    await writeFile(expiredDateLog, "expired log\n", "utf8");
    const expiredAt = new Date("2000-01-01T00:00:00.000Z");
    await utimes(expiredDateLog, expiredAt, expiredAt);
    const startScript = join(runtimeRoot, "Start Aleksi Workbench.ps1");
    const launch = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        startScript,
        "-NoBrowser"
      ],
      {
        cwd: runtimeRoot,
        stdio: "inherit",
        shell: false
      }
    );

    if (launch.status !== 0) {
      const reason = launch.error instanceof Error
        ? ` (${launch.error.message})`
        : "";
      throw new Error(`Runtime launcher failed${reason}`);
    }

    const logPath = join(runtimeRoot, "logs/latest.log");
    const logInfo = await stat(logPath);
    if (logInfo.size <= 0) {
      throw new Error("Runtime did not write logs/latest.log");
    }

    const logText = await readFile(logPath, "utf8");
    const port = parseSelectedPort(logText);
    const pidText = await readFile(join(runtimeRoot, "logs/runtime.pid"), "utf8");
    runtimeProcessId = Number(pidText.trim());
    const instance = JSON.parse(
      await readFile(join(runtimeRoot, "logs/runtime.instance.json"), "utf8")
    );
    if (
      instance.version !== manifest.version ||
      instance.buildId !== manifest.buildId
    ) {
      throw new Error("Runtime instance identity mismatch");
    }

    const homepage = await waitForUrl(`http://127.0.0.1:${port}/`);
    const healthResponse = await waitForUrl(
      `http://127.0.0.1:${port}/api/health`
    );
    const health = await healthResponse.json();
    if (
      health.ok !== true ||
      health.service !== "aleksi-workbench" ||
      health.version !== manifest.version ||
      health.buildId !== manifest.buildId
    ) {
      throw new Error("Runtime health identity mismatch");
    }
    const homepageText = await homepage.text();
    if (!homepageText.includes("root")) {
      throw new Error("Runtime homepage did not return the built frontend shell");
    }

    const logEntries = await readdir(join(runtimeRoot, "logs"));
    const dateLogName = logEntries.find((entry) => /^\d{4}-\d{2}-\d{2}\.log$/u.test(entry));
    if (dateLogName === undefined) {
      throw new Error("Runtime did not write logs/YYYY-MM-DD.log");
    }
    const dateLogInfo = await stat(join(runtimeRoot, "logs", dateLogName));
    if (dateLogInfo.size <= 0) {
      throw new Error("Runtime did not write logs/YYYY-MM-DD.log");
    }
    await stat(expiredDateLog).then(
      () => {
        throw new Error("Expired date log was not removed");
      },
      () => undefined
    );

    for (const requiredText of [
      "runtime mode: friend-preview",
      "app version:",
      "server path:",
      "dist path:",
      "data directory:",
      "logs directory:",
      "learning library:",
      "health check result:",
      "browser open result: skipped by -NoBrowser"
    ]) {
      if (!logText.includes(requiredText)) {
        throw new Error(`Runtime log missing: ${requiredText}`);
      }
    }

    const repeatedLaunch = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        startScript,
        "-NoBrowser"
      ],
      {
        cwd: runtimeRoot,
        stdio: "inherit",
        shell: false
      }
    );
    if (repeatedLaunch.status !== 0) {
      throw new Error("Repeated runtime launch failed");
    }
    const repeatedLog = await readFile(logPath, "utf8");
    const repeatedPort = parseSelectedPort(repeatedLog);
    const repeatedPid = Number(
      (await readFile(join(runtimeRoot, "logs/runtime.pid"), "utf8")).trim()
    );
    if (repeatedPort !== port || repeatedPid !== runtimeProcessId) {
      throw new Error("Repeated launch created a second runtime instead of reusing the healthy instance");
    }
    if (!repeatedLog.includes("healthy existing runtime reused")) {
      throw new Error("Repeated launch log does not prove healthy-instance reuse");
    }

    const stopScript = join(runtimeRoot, "Stop Aleksi Workbench.ps1");
    const stopped = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", stopScript],
      { cwd: runtimeRoot, stdio: "inherit", shell: false }
    );
    if (stopped.status !== 0) {
      throw new Error("Verified runtime stop script failed");
    }
    runtimeProcessId = undefined;
    await stat(join(runtimeRoot, "logs/runtime.pid")).then(
      () => {
        throw new Error("Runtime PID file still exists after verified stop");
      },
      () => undefined
    );

    console.log(`Runtime verification passed: http://127.0.0.1:${port}/`);
  } finally {
    if (Number.isInteger(runtimeProcessId)) {
      stopProcessTree(runtimeProcessId);
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
