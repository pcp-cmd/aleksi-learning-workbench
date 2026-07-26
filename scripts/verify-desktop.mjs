#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DESKTOP_IDENTITY_PATH,
  DESKTOP_INSTALLER_PATH,
  DESKTOP_MIN_INSTALLER_BYTES,
  DESKTOP_MIN_NODE_BYTES,
  DESKTOP_PACKAGE_MANIFEST_PATH,
  DESKTOP_SIDECAR_NODE_PATH,
  DESKTOP_SIDECAR_SERVER_PATH
} from "./desktop-package-rules.mjs";
import { inspectInstallerMetadata } from "./package-release.mjs";

const root = process.cwd();
const readJson = async (path) =>
  JSON.parse(await readFile(resolve(root, path), "utf8"));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

const [identity, manifest, releaseIdentity, packageJson, config, rustRuntime, rustCommands] =
  await Promise.all([
    readJson(DESKTOP_IDENTITY_PATH),
    readJson(DESKTOP_PACKAGE_MANIFEST_PATH),
    readJson("release/identity.json"),
    readJson("package.json"),
    readJson("src-tauri/tauri.conf.json"),
    readFile(resolve(root, "src-tauri/src/runtime.rs"), "utf8"),
    readFile(resolve(root, "src-tauri/src/commands.rs"), "utf8")
  ]);

if (
  identity.version !== packageJson.version ||
  config.version !== packageJson.version ||
  manifest.version !== packageJson.version ||
  identity.protocolVersion !== 1 ||
  identity.buildId !== identity.shellBuildId ||
  manifest.buildId !== identity.buildId ||
  manifest.protocolVersion !== identity.protocolVersion ||
  manifest.shellBuildId !== identity.shellBuildId ||
  manifest.sidecarBuildId !== identity.sidecarBuildId
) {
  throw new Error("Desktop version/build identity mismatch");
}
if (!/^desktop-[a-f0-9]{20}$/u.test(identity.buildId)) {
  throw new Error("Desktop build ID is invalid");
}
if (!/^sidecar-[a-f0-9]{20}$/u.test(identity.sidecarBuildId)) {
  throw new Error("Sidecar build ID is invalid");
}

const resourceChecks = [
  [DESKTOP_SIDECAR_NODE_PATH, "sidecar/node.exe"],
  [DESKTOP_SIDECAR_SERVER_PATH, "sidecar/server.cjs"]
];
for (const [path, logicalPath] of resourceChecks) {
  const data = await readFile(resolve(root, path));
  const expected = identity.files.find((entry) => entry.path === logicalPath);
  if (
    expected === undefined ||
    expected.bytes !== data.length ||
    expected.sha256 !== sha256(data)
  ) {
    throw new Error(`Desktop resource identity mismatch: ${logicalPath}`);
  }
}
if ((await stat(resolve(root, DESKTOP_SIDECAR_NODE_PATH))).size < DESKTOP_MIN_NODE_BYTES) {
  throw new Error("Bundled Node runtime is unexpectedly small");
}

const installerPath = resolve(root, DESKTOP_INSTALLER_PATH);
const installer = await readFile(installerPath);
const installerMetadata = inspectInstallerMetadata(installerPath, installer, root);
if (
  installer.length < DESKTOP_MIN_INSTALLER_BYTES ||
  installer[0] !== 0x4d ||
  installer[1] !== 0x5a ||
  manifest.installer.bytes !== installer.length ||
  manifest.installer.sha256 !== sha256(installer)
) {
  throw new Error("Desktop installer size/header/hash verification failed");
}
for (const [field, expected] of [
  ["peMachine", "I386"],
  ["authenticodeStatus", "NotSigned"],
  ["productName", releaseIdentity.displayName],
  ["fileDescription", releaseIdentity.displayName],
  ["productVersion", packageJson.version],
  ["fileVersion", packageJson.version]
]) {
  if (installerMetadata[field] !== expected) {
    throw new Error(
      `Desktop installer ${field} mismatch: ${installerMetadata[field] ?? "missing"}`
    );
  }
  if (manifest.installer[field] !== expected) {
    throw new Error(`Release manifest installer ${field} mismatch`);
  }
}
if (manifest.signed !== false || manifest.signingStatus !== "unsigned-preview") {
  throw new Error("Desktop installer signing boundary is not the canonical unsigned preview");
}
if (
  !Array.isArray(config.bundle.targets) ||
  !config.bundle.targets.includes("nsis") ||
  config.bundle.windows.webviewInstallMode.type !== "downloadBootstrapper" ||
  config.bundle.windows.nsis.installMode !== "currentUser"
) {
  throw new Error("Desktop NSIS/WebView2/current-user contract is invalid");
}
for (const required of [
  "ALEKSI_DESKTOP_SIDECAR",
  "ALEKSI_DESKTOP_PARENT_PID",
  "ALEKSI_PROTOCOL_SECRET",
  "ALEKSI_PROTOCOL_VERSION",
  "ALEKSI_SHELL_BUILD_ID",
  "ALEKSI_SIDECAR_BUILD_ID",
  "ALEKSI_SERVER_PORT",
  "sidecar/node.exe",
  "sidecar/server.cjs"
]) {
  if (!`${rustRuntime}\n${JSON.stringify(identity)}`.includes(required)) {
    throw new Error(`Desktop runtime contract is missing ${required}`);
  }
}
const loopbackFormat = 'format!("http://{}:{}", ready.host, ready.port)';
if (
  !rustRuntime.includes('if ready.host != "127.0.0.1"') ||
  !rustRuntime.includes(loopbackFormat)
) {
  throw new Error("Desktop runtime does not prove its dynamic URL is loopback-only");
}
const launcherScan = `${rustRuntime.replace(loopbackFormat, "")}\n${rustCommands}`
  .replaceAll("http://tauri.localhost", "");
if (/powershell|cmd\.exe|start-process|https?:\/\//iu.test(launcherScan)) {
  throw new Error("Desktop runtime contains a forbidden launcher/browser dependency");
}

console.log("Desktop installer verification passed.");
console.log(`Identity: ${identity.version} ${identity.buildId}`);
console.log(`Installer: ${DESKTOP_INSTALLER_PATH} (${installer.length} bytes)`);
console.log(`SHA-256: ${manifest.installer.sha256}`);
