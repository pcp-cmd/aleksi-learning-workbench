#!/usr/bin/env node
import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
  "src-tauri/capabilities/default.json",
  "src-tauri/src/lib.rs",
  "src-tauri/src/runtime.rs",
  "src-tauri/src/commands.rs",
  "src-tauri/resources/identity.json",
  "src-tauri/resources/sidecar/node.exe",
  "src-tauri/resources/sidecar/server.js"
];

for (const path of requiredFiles) {
  await access(resolve(root, path));
}

const identity = JSON.parse(
  await readFile(resolve(root, "src-tauri/resources/identity.json"), "utf8")
);
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8")
);
const config = JSON.parse(
  await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8")
);

if (identity.version !== packageJson.version || config.version !== packageJson.version) {
  throw new Error("Desktop source version identity mismatch");
}
if (!/^desktop-[a-f0-9]{20}$/u.test(identity.buildId)) {
  throw new Error("Desktop build ID is invalid");
}
if (config.bundle.windows.webviewInstallMode.type !== "downloadBootstrapper") {
  throw new Error("Desktop installer must bootstrap WebView2");
}
if (config.bundle.windows.nsis.installMode !== "currentUser") {
  throw new Error("Desktop installer must default to current-user installation");
}
if ((await stat(resolve(root, "src-tauri/resources/sidecar/node.exe"))).size < 1_000_000) {
  throw new Error("Bundled Node sidecar runtime is unexpectedly small");
}

console.log("Desktop source/resources verification passed.");
console.log(`Identity: ${identity.version} ${identity.buildId}`);
