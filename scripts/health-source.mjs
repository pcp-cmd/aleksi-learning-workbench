#!/usr/bin/env node
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { SOURCE_PACKAGE_PATH } from "./package-rules.mjs";
import { extractStoredZip } from "./zip-store.mjs";

const root = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runChecked(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd")
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "aleksi-source-health-"));
const zipPath = resolve(temporaryRoot, "source.zip");
const sourceRoot = resolve(temporaryRoot, "source");

try {
  runChecked("node", ["scripts/package-source.mjs", zipPath], root);
  await extractStoredZip(zipPath, sourceRoot);

  for (const required of [
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
    "src-tauri/src/lib.rs"
  ]) {
    await access(resolve(sourceRoot, required));
  }
  for (const forbidden of [
    "src-tauri/target",
    "src-tauri/resources/identity.json",
    "src-tauri/resources/sidecar/node.exe"
  ]) {
    try {
      await access(resolve(sourceRoot, forbidden));
      throw new Error(`Generated desktop artifact leaked into source package: ${forbidden}`);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  runChecked(npmCommand, ["ci"], sourceRoot);
  runChecked(npmCommand, ["run", "typecheck"], sourceRoot);
  runChecked(npmCommand, ["run", "build"], sourceRoot);
  runChecked(npmCommand, ["run", "test"], sourceRoot);

  console.log(`Source health passed from ${SOURCE_PACKAGE_PATH}`);
} finally {
  if (!process.env.ALEKSI_KEEP_SOURCE_HEALTH_TEMP) {
    await rm(temporaryRoot, { force: true, recursive: true });
  } else {
    console.log(`Kept source health temp directory: ${temporaryRoot}`);
  }
}
