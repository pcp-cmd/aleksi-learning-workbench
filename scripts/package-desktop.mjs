#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with exit ${result.status}: ${result.stderr.trim()}`
    );
  }
  return result.stdout.trimEnd();
}

function captureSourceStateBeforeBuild() {
  const commit = gitOutput(["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("Git did not return a full 40-character commit SHA");
  }
  const status = gitOutput([
    "status",
    "--porcelain=v1",
    "--untracked-files=all"
  ]);
  const dirtyFiles = status.length === 0
    ? []
    : status
        .split(/\r?\n/u)
        .map((line) => line.slice(3).replaceAll("\\", "/"))
        .sort();
  const worktreeFingerprint = createHash("sha256")
    .update("pre-build-source-state\0")
    .update(commit)
    .update("\0")
    .update(status)
    .digest("hex");
  return {
    commit,
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
    worktreeFingerprint,
    worktreeFingerprintScope: "pre-build-git-status-porcelain-v1"
  };
}

// Capture provenance before prepare:desktop intentionally generates tracked runtime
// identity resources. Release qualification must describe the checked-out source,
// not temporary files produced by the build itself.
const sourceState = captureSourceStateBeforeBuild();

const signingConfigPath = process.env.ALEKSI_TAURI_SIGNING_CONFIG;
if (signingConfigPath === undefined) {
  runChecked(npmCommand, ["run", "build:desktop"]);
} else {
  const resolvedSigningConfig = resolve(signingConfigPath);
  const signingConfig = JSON.parse(
    await readFile(resolvedSigningConfig, "utf8")
  );
  const windowsSigning = signingConfig.bundle?.windows;
  if (
    !/^[A-F0-9]{40}$/u.test(windowsSigning?.certificateThumbprint ?? "") ||
    windowsSigning?.digestAlgorithm !== "sha256" ||
    !/^https?:\/\//u.test(windowsSigning?.timestampUrl ?? "")
  ) {
    throw new Error("ALEKSI_TAURI_SIGNING_CONFIG is not a canonical signing config");
  }
  runChecked(npmCommand, ["run", "prepare:desktop"]);
  runChecked(npmCommand, [
    "exec",
    "--",
    "tauri",
    "build",
    "--bundles",
    "nsis",
    "--config",
    resolvedSigningConfig
  ]);
}

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
  sourceInstaller: relative(root, builtInstaller).replaceAll("\\", "/"),
  sourceState
});
if (manifest.installer === null) {
  throw new Error("Release evidence did not record the copied desktop installer");
}

console.log(`Created desktop installer: ${outputPath}`);
console.log(`Desktop identity: ${manifest.version} ${manifest.buildId}`);
console.log(`Source installer: ${basename(builtInstaller)} (${(await stat(outputPath)).size} bytes)`);
console.log(`Installer SHA-256: ${manifest.installer.sha256}`);
