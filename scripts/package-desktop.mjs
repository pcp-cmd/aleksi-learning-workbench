#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat
} from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import {
  DESKTOP_INSTALLER_PATH,
  DESKTOP_MIN_INSTALLER_BYTES,
  DESKTOP_NSIS_DIRECTORY,
  isNsisSetupCandidate
} from "./desktop-package-rules.mjs";
import { generateReleaseEvidence } from "./package-release.mjs";

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
const expectedRuntimeIdentity = {
  ...identity,
  protocolVersion: identity.protocolVersion,
  shellBuildId: identity.shellBuildId,
  sidecarBuildId: identity.sidecarBuildId
};
const { manifest } = await generateReleaseEvidence({
  root,
  invocation: "npm.cmd run package:desktop",
  runtimeIdentity: expectedRuntimeIdentity,
  sourceInstaller: relative(root, builtInstaller).replaceAll("\\", "/")
});
if (manifest.installer === null) {
  throw new Error("Release evidence did not record the copied desktop installer");
}

console.log(`Created desktop installer: ${outputPath}`);
console.log(`Desktop identity: ${manifest.version} ${manifest.buildId}`);
console.log(`Source installer: ${basename(builtInstaller)} (${(await stat(outputPath)).size} bytes)`);
console.log(`Installer SHA-256: ${manifest.installer.sha256}`);
