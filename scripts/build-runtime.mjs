#!/usr/bin/env node
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { RUNTIME_BUILD_DIR } from "./runtime-package-rules.mjs";

const root = process.cwd();
const runtimeBuildDir = resolve(root, RUNTIME_BUILD_DIR);
const runtimeAppDir = resolve(runtimeBuildDir, "app");

await rm(runtimeBuildDir, { recursive: true, force: true });
await mkdir(runtimeAppDir, { recursive: true });

await build({
  entryPoints: [resolve(root, "server/runtime-entry.ts")],
  outfile: resolve(runtimeAppDir, "server.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: false,
  logLevel: "info"
});

console.log(`Created runtime server bundle: ${resolve(runtimeAppDir, "server.cjs")}`);
