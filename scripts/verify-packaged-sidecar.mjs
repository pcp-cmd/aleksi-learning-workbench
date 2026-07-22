#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const READY_PREFIX = "ALEKSI_READY ";
const START_TIMEOUT_MS = 20_000;
const EXIT_TIMEOUT_MS = 8_000;
const root = process.cwd();
const identity = JSON.parse(
  await readFile(resolve(root, "src-tauri/resources/identity.json"), "utf8")
);
const packagedNode = resolve(root, "src-tauri/resources/sidecar/node.exe");
const packagedServer = resolve(root, "src-tauri/resources/sidecar/server.cjs");

if (
  process.platform !== "win32" &&
  process.env.ALEKSI_ALLOW_NON_WINDOWS_SIDECAR_VERIFY !== "1"
) {
  throw new Error("Packaged sidecar verification must run on Windows");
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForExit(child, timeoutMs = EXIT_TIMEOUT_MS) {
  if (child.exitCode !== null) return child.exitCode;
  return await Promise.race([
    new Promise((resolvePromise, rejectPromise) => {
      child.once("exit", (code) => resolvePromise(code));
      child.once("error", rejectPromise);
    }),
    delay(timeoutMs).then(() => {
      throw new Error(`Sidecar did not exit within ${timeoutMs}ms`);
    })
  ]);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = text.length === 0 ? null : JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  return payload;
}

async function runSidecar({ serverPath, settingsDir, defaultLibrary, fallbackLibrary, logDir, label }) {
  await mkdir(logDir, { recursive: true });
  await writeFile(join(logDir, "sidecar.stdout.log"), `${label} stdout probe\n`, "utf8");
  await writeFile(join(logDir, "sidecar.stderr.log"), `${label} stderr probe\n`, "utf8");

  const child = spawn(packagedNode, [serverPath], {
    cwd: dirname(serverPath),
    env: {
      ...process.env,
      ALEKSI_DESKTOP_SIDECAR: "1",
      ALEKSI_RUNTIME_MODE: "tauri-desktop",
      ALEKSI_SERVER_PORT: "0",
      ALEKSI_APP_SETTINGS_DIR: settingsDir,
      ALEKSI_DEFAULT_VAULT_PATH: defaultLibrary,
      ALEKSI_APP_DATA_VAULT_PATH: fallbackLibrary,
      ALEKSI_APP_VERSION: identity.version,
      ALEKSI_BUILD_ID: identity.buildId,
      ALEKSI_RUNTIME_LOG_DIR: logDir
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    const ready = await Promise.race([
      new Promise((resolvePromise, rejectPromise) => {
        const inspect = () => {
          for (const line of stdout.split(/\r?\n/u)) {
            if (!line.startsWith(READY_PREFIX)) continue;
            try {
              resolvePromise(JSON.parse(line.slice(READY_PREFIX.length)));
            } catch (error) {
              rejectPromise(new Error(`Invalid ready record: ${line}`, { cause: error }));
            }
            return;
          }
          if (child.exitCode !== null) {
            rejectPromise(new Error(`Sidecar exited before ready (${child.exitCode}). stdout=${stdout} stderr=${stderr}`));
          }
        };
        child.stdout.on("data", inspect);
        child.once("exit", inspect);
        child.once("error", rejectPromise);
        inspect();
      }),
      delay(START_TIMEOUT_MS).then(() => {
        throw new Error(`Timed out waiting for sidecar readiness. stdout=${stdout} stderr=${stderr}`);
      })
    ]);

    if (
      ready.host !== "127.0.0.1" ||
      !Number.isInteger(ready.port) ||
      ready.port < 1 ||
      ready.port > 65_535 ||
      ready.version !== identity.version ||
      ready.buildId !== identity.buildId
    ) {
      throw new Error(`Unexpected ready record: ${JSON.stringify(ready)}`);
    }

    const baseUrl = `http://127.0.0.1:${ready.port}`;
    const health = await requestJson(`${baseUrl}/api/health`);
    if (health.ok !== true || health.version !== identity.version || health.buildId !== identity.buildId) {
      throw new Error(`Health identity mismatch: ${JSON.stringify(health)}`);
    }

    const prepared = await requestJson(`${baseUrl}/api/vault/auto-prepare`, { method: "POST" });
    if (prepared.status?.initialized !== true || prepared.status?.writable !== true) {
      throw new Error(`Learning library was not prepared: ${JSON.stringify(prepared)}`);
    }

    const today = await requestJson(`${baseUrl}/api/today/next`);
    if (typeof today.nextAction?.href !== "string") {
      throw new Error(`Today route is unavailable: ${JSON.stringify(today)}`);
    }

    const reading = await requestJson(`${baseUrl}/api/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `桌面链路验证 ${label}`,
        concept: "PackagedSidecarSmoke",
        body: "这是一段包含中文、空格路径与 Markdown 的桌面链路验证。",
        source: "manual-paste"
      })
    });
    if (typeof reading.reading?.id !== "string") {
      throw new Error(`Reading persistence failed: ${JSON.stringify(reading)}`);
    }

    const diagnosticsResponse = await fetch(`${baseUrl}/api/runtime/diagnostics`);
    if (!diagnosticsResponse.ok) {
      throw new Error(`Diagnostics request failed with HTTP ${diagnosticsResponse.status}`);
    }
    const diagnostics = await diagnosticsResponse.json();
    const diagnosticNames = new Set((diagnostics.logs ?? []).map((entry) => entry.name));
    for (const expectedName of ["sidecar.stdout.log", "sidecar.stderr.log"]) {
      if (!diagnosticNames.has(expectedName)) {
        throw new Error(`Diagnostics omitted ${expectedName}: ${JSON.stringify(diagnostics)}`);
      }
    }

    await requestJson(`${baseUrl}/api/runtime/exit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true })
    });
    const exitCode = await waitForExit(child);
    if (exitCode !== 0) {
      throw new Error(`Sidecar exited with code ${exitCode}. stdout=${stdout} stderr=${stderr}`);
    }

    return { port: ready.port, libraryPath: prepared.status.path };
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await waitForExit(child).catch(() => undefined);
    }
  }
}

const tempRoot = await mkdtemp(join(tmpdir(), "Aleksi 桌面链路验证 "));
try {
  const moduleContext = join(tempRoot, "只读 Runtime 包", "app");
  const copiedServer = join(moduleContext, "server.cjs");
  await mkdir(moduleContext, { recursive: true });
  await copyFile(packagedServer, copiedServer);
  await writeFile(join(tempRoot, "只读 Runtime 包", "package.json"), '{"type":"module"}\n', "utf8");
  await chmod(copiedServer, 0o444);

  const settingsDir = join(tempRoot, "设置 数据");
  const defaultLibrary = join(tempRoot, "中文 文档", "Aleksi Learning Workbench");
  const fallbackLibrary = join(tempRoot, "App Data", "library");
  const logDir = join(tempRoot, "日志");

  const first = await runSidecar({
    serverPath: copiedServer,
    settingsDir,
    defaultLibrary,
    fallbackLibrary,
    logDir,
    label: "first"
  });
  const second = await runSidecar({
    serverPath: copiedServer,
    settingsDir,
    defaultLibrary,
    fallbackLibrary,
    logDir,
    label: "restart"
  });

  if (first.libraryPath !== second.libraryPath) {
    throw new Error(`Restart changed the active library: ${first.libraryPath} -> ${second.libraryPath}`);
  }
  console.log("Packaged sidecar verification passed.");
  console.log(`First dynamic port: ${first.port}`);
  console.log(`Restart dynamic port: ${second.port}`);
  console.log(`Learning library: ${first.libraryPath}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
