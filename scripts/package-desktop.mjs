#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import {
  DESKTOP_INSTALLER_PATH,
  DESKTOP_MIN_INSTALLER_BYTES,
  DESKTOP_NSIS_DIRECTORY,
  DESKTOP_PACKAGE_MANIFEST_PATH,
  isNsisSetupCandidate
} from "./desktop-package-rules.mjs";

const root = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runChecked(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd")
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

runChecked(npmCommand, ["run", "build:desktop"]);

const nsisDirectory = resolve(root, DESKTOP_NSIS_DIRECTORY);
const candidates = (await readdir(nsisDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && isNsisSetupCandidate(entry.name))
  .map((entry) => resolve(nsisDirectory, entry.name));
if (candidates.length !== 1) {
  throw new Error(`Expected exactly one NSIS installer, found ${candidates.length}`);
}

const builtInstaller = candidates[0];
const installerData = await readFile(builtInstaller);
if (
  installerData.length < DESKTOP_MIN_INSTALLER_BYTES ||
  installerData[0] !== 0x4d ||
  installerData[1] !== 0x5a
) {
  throw new Error("Tauri NSIS output is not a valid real Windows executable");
}

const outputPath = resolve(root, DESKTOP_INSTALLER_PATH);
await mkdir(resolve(outputPath, ".."), { recursive: true });
await copyFile(builtInstaller, outputPath);
const identity = JSON.parse(
  await readFile(resolve(root, "src-tauri/resources/identity.json"), "utf8")
);
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const manifest = {
  schemaVersion: 1,
  packageType: "tauri-nsis",
  product: "Aleksi Workbench",
  version: packageJson.version,
  buildId: identity.buildId,
  sourceInstaller: relative(root, builtInstaller).replaceAll("\\", "/"),
  installer: {
    path: DESKTOP_INSTALLER_PATH,
    sourceName: basename(builtInstaller),
    bytes: (await stat(outputPath)).size,
    sha256: sha256(await readFile(outputPath))
  }
};
await writeFile(
  resolve(root, DESKTOP_PACKAGE_MANIFEST_PATH),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(`Created desktop installer: ${outputPath}`);
console.log(`Desktop identity: ${manifest.version} ${manifest.buildId}`);
console.log(`Installer SHA-256: ${manifest.installer.sha256}`);
