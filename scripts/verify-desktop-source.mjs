#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
  "src-tauri/capabilities/default.json",
  "src-tauri/src/lib.rs",
  "src-tauri/src/runtime.rs",
  "src-tauri/src/commands.rs",
  "scripts/prepare-desktop.mjs",
  "scripts/verify-installed-desktop.ps1",
  "scripts/package-rules.mjs"
];

for (const path of requiredFiles) {
  await access(resolve(root, path));
}

const readSource = (path) => readFile(resolve(root, path), "utf8");
const [packageJson, config, cargo, cargoLock, shell, runtime, commands, prepare, installedVerifier, packageRules] =
  await Promise.all([
    readSource("package.json").then(JSON.parse),
    readSource("src-tauri/tauri.conf.json").then(JSON.parse),
    readSource("src-tauri/Cargo.toml"),
    readSource("src-tauri/Cargo.lock"),
    readSource("src-tauri/src/lib.rs"),
    readSource("src-tauri/src/runtime.rs"),
    readSource("src-tauri/src/commands.rs"),
    readSource("scripts/prepare-desktop.mjs"),
    readSource("scripts/verify-installed-desktop.ps1"),
    readSource("scripts/package-rules.mjs")
  ]);

const cargoVersion = cargo.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/mu)?.[1];
const cargoLockVersion = cargoLock.match(/\[\[package\]\]\nname = "aleksi-workbench"\nversion = "([^"]+)"/u)?.[1];
if (
  config.version !== packageJson.version ||
  cargoVersion !== packageJson.version ||
  cargoLockVersion !== packageJson.version
) {
  throw new Error(
    `Desktop source version mismatch: npm=${packageJson.version} tauri=${config.version} cargo=${cargoVersion ?? "missing"} lock=${cargoLockVersion ?? "missing"}`
  );
}
const mainWindow = config.app?.windows?.find((window) => window.label === "main");
if (mainWindow?.minWidth !== 960 || mainWindow?.minHeight !== 680) {
  throw new Error("Desktop minimum window contract is invalid");
}
if (
  !Array.isArray(config.bundle?.targets) ||
  !config.bundle.targets.includes("nsis") ||
  config.bundle.windows?.webviewInstallMode?.type !== "downloadBootstrapper" ||
  config.bundle.windows?.nsis?.installMode !== "currentUser"
) {
  throw new Error("Desktop NSIS/WebView2/current-user source contract is invalid");
}

for (const dependency of [
  'tauri-plugin-single-instance = "2"',
  'tauri-plugin-window-state = "2"'
]) {
  if (!cargo.includes(dependency)) {
    throw new Error(`Desktop source is missing ${dependency}`);
  }
}
for (const contract of [
  "tauri_plugin_single_instance::init",
  "window.unminimize()",
  "window.show()",
  "window.set_focus()",
  "tauri_plugin_window_state::Builder::default().build()"
]) {
  if (!shell.includes(contract)) {
    throw new Error(`Desktop shell contract is missing ${contract}`);
  }
}
for (const contract of [
  'if ready.host != "127.0.0.1"',
  'format!("http://{}:{}", ready.host, ready.port)',
  '"ALEKSI_DESKTOP_SIDECAR"',
  '"ALEKSI_SERVER_PORT"',
  '"ALEKSI_APP_DATA_VAULT_PATH"',
  'Path::new("sidecar/node.exe")',
  'Path::new("sidecar/server.cjs")'
]) {
  if (!runtime.includes(contract)) {
    throw new Error(`Desktop runtime source contract is missing ${contract}`);
  }
}
if (
  !prepare.includes("process.execPath") ||
  !prepare.includes('"sidecar/node.exe"') ||
  !prepare.includes('"sidecar/server.cjs"') ||
  !prepare.includes('resolve(resourcesDirectory, "identity.json")')
) {
  throw new Error("Desktop resource preparation source contract is invalid");
}
for (const installedGate of [
  "Get-Sha256Lower",
  "Assert-StartupRitualSurvival",
  "sidecar/server.cjs",
  "second-launch",
  "Reading did not persist across installed app restart"
]) {
  if (!installedVerifier.includes(installedGate)) {
    throw new Error(`Installed desktop verifier is missing ${installedGate}`);
  }
}

for (const generatedPrefix of [
  '"src-tauri/target/"',
  '"src-tauri/resources/sidecar/"',
  '"src-tauri/resources/identity.json"'
]) {
  if (!packageRules.includes(generatedPrefix)) {
    throw new Error(`Source package rules must exclude ${generatedPrefix}`);
  }
}

const loopbackFormat = 'format!("http://{}:{}", ready.host, ready.port)';
const launcherScan = `${runtime.replace(loopbackFormat, "")}\n${commands}`;
if (/powershell|cmd\.exe|start-process|https?:\/\//iu.test(launcherScan)) {
  throw new Error("Desktop source contains a forbidden launcher/browser dependency");
}

console.log("Desktop source contract verification passed.");
console.log(`Version: ${packageJson.version}`);
console.log("Generated resources are intentionally verified only after prepare:desktop.");
