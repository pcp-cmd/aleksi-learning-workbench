#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { extractStoredZip } from "./zip-store.mjs";

const root = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const sourcePackagePath = resolve(root, "artifacts/aleksi-learning-workbench-source.zip");

function runStep(label, command, args, cwd = root) {
  console.log(`\n[clean-base] ${label}`);
  console.log(`[clean-base] command: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd")
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${result.status}`);
  }
  console.log(`[clean-base] passed: ${label}`);
}

async function assertContains(filePath, fragments) {
  const source = await readFile(resolve(root, filePath), "utf8");
  if (source.trim().length < 1000) {
    throw new Error(`${filePath} looks too small to be a real governance document`);
  }
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      throw new Error(`${filePath} is missing required fragment: ${fragment}`);
    }
  }
}

async function verifyDocs() {
  console.log("\n[clean-base] docs/current necessary file check");
  await assertContains("docs/current/TECH_DEBT_REGISTER.md", [
    "TD-P0-001",
    "TD-P0-002",
    "TD-P0-003",
    "TD-P0-004",
    "TD-P0-005",
    "TD-P0-006",
    "TD-P1-001",
    "TD-P1-002",
    "TD-P1-003",
    "TD-P1-004",
    "TD-P1-005",
    "TD-P1-006",
    "TD-P1-007",
    "TD-P1-008",
    "TD-P1-009",
    "TD-P1-010",
    "风险",
    "处理方案",
    "验收标准",
    "状态",
    "相关文件"
  ]);
  await assertContains("docs/current/PACKAGING_ROADMAP.md", [
    "已完成基础：V0.2 clean source package",
    "Friend Preview Portable Runtime v0.1",
    "当前交付：Windows Desktop Verification Preview",
    "下一阶段：Signed Desktop Release",
    "AleksiWorkbench-Desktop-Source-20260716.zip",
    "Aleksi-Workbench-Setup.exe",
    "runtime package 只能证明该便携包",
    "clean source 通过不等于 runtime、installer 或 installed runtime 通过"
  ]);
  await assertContains("docs/current/FONT_USAGE_POLICY.md", [
    "worktree/private-local",
    "允许 public/fonts/claude 存在",
    "默认排除 public/fonts/claude",
    "runtime private build",
    "必须显式 private mode",
    "public/open-source/runtime",
    "禁止包含，除非授权确认",
    "不要删除用户本地私用字体",
    "不要让 source package 带字体"
  ]);
  console.log("[clean-base] passed: docs/current necessary file check");
}

async function verifySourceIdempotency() {
  console.log("\n[clean-base] source idempotent package test");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "aleksi-clean-base-source-"));
  const sourceRoot = resolve(temporaryRoot, "source");
  const repackedZip = resolve(temporaryRoot, "source-repacked.zip");

  try {
    await extractStoredZip(sourcePackagePath, sourceRoot);
    runStep(
      "source idempotent package: package:source from extracted zip",
      "node",
      ["scripts/package-source.mjs", repackedZip],
      sourceRoot
    );
    runStep(
      "source idempotent package: package:audit from extracted zip",
      "node",
      ["scripts/audit-package.mjs", repackedZip],
      sourceRoot
    );
  } finally {
    if (!process.env.ALEKSI_KEEP_CLEAN_BASE_TEMP) {
      await rm(temporaryRoot, { force: true, recursive: true });
    } else {
      console.log(`[clean-base] kept temp directory: ${temporaryRoot}`);
    }
  }

  console.log("[clean-base] passed: source idempotent package test");
}

runStep("npm run typecheck", npmCommand, ["run", "typecheck"]);
runStep("npm run build", npmCommand, ["run", "build"]);
runStep("npm test", npmCommand, ["test"]);
runStep("npm run package:source", npmCommand, ["run", "package:source"]);
runStep("npm run package:audit", npmCommand, ["run", "package:audit"]);
runStep("npm run health:source", npmCommand, ["run", "health:source"]);
await verifySourceIdempotency();
await verifyDocs();

console.log("\n[clean-base] verify:clean-base passed");
