#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { RUNTIME_PACKAGE_DIR } from "./runtime-package-rules.mjs";

const candidates = [
  `${RUNTIME_PACKAGE_DIR}/start-runtime.ps1`,
  "start-runtime.ps1"
];

const runtimeLauncher = candidates
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));

if (!runtimeLauncher) {
  console.error(
    [
      "Runtime package is not built yet.",
      "Run npm run package:runtime first, or use npm run start:dev for source development.",
      "Runtime packaging is tracked in docs/current/PACKAGING_ROADMAP.md."
    ].join("\n")
  );
  process.exit(1);
}

const result = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runtimeLauncher],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false
  }
);

process.exit(result.status ?? 1);
