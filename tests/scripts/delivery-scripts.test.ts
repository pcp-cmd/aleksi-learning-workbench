import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const execFileAsync = promisify(execFile);

async function readProjectFile(relativePath: string): Promise<string> {
  return readFile(join(projectRoot, relativePath), "utf8");
}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function writeStoredZip(
  zipPath: string,
  entries: Array<{ name: string; content: Buffer | string }>
): Promise<void> {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, "utf8");
    const digest = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(digest, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(digest, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);

  await writeFile(zipPath, Buffer.concat([...localParts, centralDirectory, end]));
}

function runtimeManifestEntry(
  entries: Array<{ name: string; content: Buffer | string }>
): { name: string; content: string } {
  const buildHash = createHash("sha256");
  const buildInputs = entries
    .filter((entry) =>
      /\/app\/(?:server\.cjs|dist\/.*)$/u.test(entry.name)
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of buildInputs) {
    const path = entry.name.replace(/^AleksiWorkbench-Preview\//u, "");
    const data = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, "utf8");
    buildHash.update(`${path}\0${data.byteLength}\0`, "utf8");
    buildHash.update(data);
    buildHash.update("\0", "utf8");
  }

  return {
    name: "AleksiWorkbench-Preview/app/runtime-manifest.json",
    content: `${JSON.stringify({
      schemaVersion: 1,
      packageType: "runtime",
      version: "0.1.0",
      buildId: `sha256-${buildHash.digest("hex").slice(0, 20)}`,
      files: entries.map((entry) => ({
        path: entry.name.replace(/^AleksiWorkbench-Preview\//u, ""),
        bytes: Buffer.byteLength(entry.content),
        sha256: sha256(entry.content)
      }))
    })}\n`
  };
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

type StoredZipEntry = {
  content: Buffer;
  name: string;
};

async function readStoredZip(zipPath: string): Promise<StoredZipEntry[]> {
  const archive = await readFile(zipPath);
  const minimumEndLength = 22;
  const searchStart = Math.max(0, archive.length - 65557);
  let endOffset = -1;

  for (let offset = archive.length - minimumEndLength; offset >= searchStart; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }

  if (endOffset === -1) {
    throw new Error(`Invalid ZIP: missing end-of-central-directory in ${zipPath}`);
  }

  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  const entries: StoredZipEntry[] = [];
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const contentStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const contentLength = archive.readUInt32LE(localHeaderOffset + 22);
    entries.push({
      content: archive.subarray(contentStart, contentStart + contentLength),
      name
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

describe("delivery scripts", () => {
  it("keeps generated TypeScript build info files out of desktop package manifests", async () => {
    const script = await readProjectFile("scripts/verify-desktop-package.ps1");

    expect(script).toContain("$ExcludedFilePatterns");
    expect(script).toContain("*.tsbuildinfo");
    expect(script).toContain("'.vite'");
    expect(script).toContain("'coverage'");
    expect(script).toContain("Test-IsExcludedFileName");
    expect(script).not.toContain("$AllowNodeModules");
  });

  it("installs desktop package dependencies without mutating the lockfile", async () => {
    const script = await readProjectFile("scripts/verify-desktop-package.ps1");

    expect(script).toContain("Invoke-CheckedCommand $root $npmPath @('ci')");
    expect(script).not.toContain("Invoke-CheckedCommand $root $npmPath @('install')");
  });

  it("keeps server date logic on the shared side of the source tree boundary", async () => {
    const reviewService = await readProjectFile("server/services/review-service.ts");
    const srcDateFacade = await readProjectFile("src/lib/date.ts");

    expect(reviewService).toContain("../../shared/date");
    expect(reviewService).not.toContain("../../src/lib/date");
    expect(srcDateFacade.trim()).toBe('export * from "../../shared/date";');
  });

  it("ships a launcher that waits for the workbench to become ready before opening the browser", async () => {
    const launcher = await readProjectFile("scripts/start-workbench.cmd");
    const powerShellLauncher = await readProjectFile("scripts/start-workbench.ps1");
    const rootEntries = await readdir(projectRoot);

    expect(launcher).not.toContain("timeout /t 5");
    expect(launcher).toContain("start-workbench.ps1");
    expect(powerShellLauncher).toContain("Invoke-RestMethod");
    expect(powerShellLauncher).toContain("http://127.0.0.1:5173/api/health");
    expect(powerShellLauncher).toContain("service -eq 'aleksi-workbench'");
    expect(powerShellLauncher).toContain("Workbench did not become ready");
    expect(powerShellLauncher).toContain("node_modules");
    expect(powerShellLauncher).toContain("First source startup");
    expect(powerShellLauncher).toContain("if ($firstRun) { 180 } else { 60 }");
    expect(powerShellLauncher).toContain("[switch]$VerifyStartup");
    expect(powerShellLauncher).toContain("Source launcher startup verification passed.");
    expect(powerShellLauncher.indexOf("taskkill.exe /PID $process.Id /T /F")).toBeLessThan(
      powerShellLauncher.indexOf("Stop-Process -Id $process.Id -Force")
    );
    expect(rootEntries.filter((entry) => /[^\x00-\x7F]/u.test(entry))).not.toContain(
      "启动 Aleksi Workbench.cmd"
    );
  });

  it("pins UTF-8/LF editor behavior for source deliveries", async () => {
    const editorConfig = await readProjectFile(".editorconfig");
    const gitAttributes = await readProjectFile(".gitattributes");

    expect(editorConfig).toContain("root = true");
    expect(editorConfig).toContain("charset = utf-8");
    expect(editorConfig).toContain("end_of_line = lf");
    expect(editorConfig).toContain("insert_final_newline = true");
    expect(editorConfig).toContain("indent_style = space");
    expect(editorConfig).toContain("indent_size = 2");
    expect(gitAttributes).toContain("* text=auto eol=lf");
    expect(gitAttributes).toContain("*.cmd text eol=crlf");
    expect(gitAttributes).toContain("*.ps1 text eol=crlf");
  });

  it("does not hard-code the maintainer's local user path in production code", async () => {
    const vaultService = await readProjectFile("server/services/vault-service.ts");

    expect(vaultService).not.toContain("C:\\\\Users\\\\pcp");
    expect(vaultService).toContain("defaultLearningLibraryPath()");
  });

  it("sets PowerShell startup encoding to UTF-8 without relying on redirected Chinese output", async () => {
    const launcher = await readProjectFile("scripts/start-workbench.ps1");

    expect(launcher).toContain("chcp 65001");
    expect(launcher).toContain("System.Text.UTF8Encoding $false");
    expect(launcher).toContain("[Console]::InputEncoding");
    expect(launcher).toContain("[Console]::OutputEncoding");
    expect(launcher).toContain("$OutputEncoding");
    expect(launcher).toContain("$env:PYTHONUTF8 = \"1\"");
    expect(launcher).toContain("$env:PYTHONIOENCODING = \"utf-8\"");
  });

  it("declares source packaging, package audit, source health, and split start scripts", async () => {
    const packageJson = JSON.parse(await readProjectFile("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      "package:source": expect.stringContaining("package-source"),
      "package:audit": expect.stringContaining("audit-package"),
      "health:source": expect.stringContaining("health-source"),
      "start:dev": expect.any(String),
      "start:runtime": expect.any(String)
    });
    expect(packageJson.scripts["start:runtime"]).not.toContain("npm run dev");
    expect(packageJson.scripts["start:runtime"]).not.toContain("vite");
  });

  it("declares a runtime package build, audit, verification, and non-dev startup chain", async () => {
    const packageJson = JSON.parse(await readProjectFile("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      "build:runtime": expect.stringContaining("build-runtime"),
      "package:runtime": expect.stringContaining("package-runtime"),
      "audit:runtime": expect.stringContaining("audit-runtime"),
      "verify:runtime": expect.stringContaining("verify-runtime"),
      "start:runtime": expect.stringContaining("start-runtime")
    });

    const runtimeStartup = await readProjectFile("scripts/start-runtime.mjs");
    const startupText = runtimeStartup.toLowerCase();

    expect(startupText).not.toContain("npm install");
    expect(startupText).not.toContain("npm run dev");
    expect(startupText).not.toContain("vite ");
    expect(startupText).not.toContain("tsx watch");
    expect(startupText).not.toContain("concurrently");
  });

  it("audits the real zip entries and rejects forbidden delivery contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-package-audit-"));
    const badZip = join(directory, "bad.zip");
    const privateFontZip = join(directory, "private-font.zip");
    const runtimeDebugZip = join(directory, "runtime-debug.zip");
    const runtimeDebugCaseVariantZip = join(
      directory,
      "runtime-debug-case-variant.zip"
    );
    const previewRuntimeZip = join(directory, "preview-runtime.zip");
    const runtimeNodeZip = join(directory, "runtime-node.zip");
    const latestLogZip = join(directory, "latest-log.zip");
    const runtimePidZip = join(directory, "runtime-pid.zip");
    const localEnvZip = join(directory, "local-env.zip");
    const cleanZip = join(directory, "clean.zip");
    await writeStoredZip(badZip, [
      { name: "package.json", content: "{}" },
      { name: "node_modules/vite/bin/vite.js", content: "bad" }
    ]);
    await writeStoredZip(privateFontZip, [
      { name: "package.json", content: "{}" },
      { name: "public/fonts/claude/c66fc489e-C-BHYa_K.ttf", content: "private font" }
    ]);
    await writeStoredZip(runtimeDebugZip, [
      { name: "package.json", content: "{}" },
      { name: ".runtime-debug/AleksiWorkbench-Preview/runtime/node.exe", content: "node" },
      { name: ".runtime-debug/AleksiWorkbench-Preview/app/server.cjs", content: "server" },
      { name: ".runtime-debug/AleksiWorkbench-Preview/logs/latest.log", content: "C:\\Users\\pcp" },
      { name: ".runtime-debug/AleksiWorkbench-Preview/logs/runtime.pid", content: "1234" }
    ]);
    await writeStoredZip(runtimeDebugCaseVariantZip, [
      { name: "package.json", content: "{}" },
      {
        name: ".RUNTIME-DEBUG/AleksiWorkbench-Preview/runtime/node.exe",
        content: "node"
      }
    ]);
    await writeStoredZip(previewRuntimeZip, [
      { name: "package.json", content: "{}" },
      { name: "AleksiWorkbench-Preview/app/server.cjs", content: "server" }
    ]);
    await writeStoredZip(runtimeNodeZip, [
      { name: "package.json", content: "{}" },
      { name: "debug/runtime/node.exe", content: "node" }
    ]);
    await writeStoredZip(latestLogZip, [
      { name: "package.json", content: "{}" },
      { name: "debug/logs/latest.log", content: "C:\\Users\\pcp" }
    ]);
    await writeStoredZip(runtimePidZip, [
      { name: "package.json", content: "{}" },
      { name: "debug/runtime.pid", content: "1234" }
    ]);
    await writeStoredZip(localEnvZip, [
      { name: "package.json", content: "{}" },
      { name: ".env.local", content: "TOKEN=private" }
    ]);
    await writeStoredZip(cleanZip, [
      { name: "package.json", content: "{}" },
      { name: ".env.example", content: "ALEKSI_SERVER_PORT=52876" },
      { name: "src/main.tsx", content: "ok" }
    ]);

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", badZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("node_modules/")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", privateFontZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("public/fonts/claude/")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", runtimeDebugZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(".runtime-debug/")
    });

    await expect(
      execFileAsync(
        "node",
        ["scripts/audit-package.mjs", runtimeDebugCaseVariantZip],
        { cwd: projectRoot }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(".runtime-debug/")
    });

    for (const [zipPath, expected] of [
      [previewRuntimeZip, "AleksiWorkbench-Preview/"],
      [runtimeNodeZip, "runtime/node.exe"],
      [latestLogZip, "logs/latest.log"],
      [runtimePidZip, "runtime.pid"],
      [localEnvZip, ".env and .env.* except .env.example"]
    ]) {
      await expect(
        execFileAsync("node", ["scripts/audit-package.mjs", zipPath], {
          cwd: projectRoot
        })
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(expected)
      });
    }

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", cleanZip], {
        cwd: projectRoot
      })
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Package audit passed")
    });
  });

  it("rejects source packages that exceed archive, total-content, or per-entry limits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-package-size-audit-"));
    const oversizedEntryZip = join(directory, "oversized-entry.zip");
    const oversizedContentsZip = join(directory, "oversized-contents.zip");
    const oversizedArchiveZip = join(directory, "oversized-archive.zip");
    const threeMiB = Buffer.alloc(3 * 1024 * 1024, 0x61);

    await writeStoredZip(oversizedEntryZip, [
      {
        name: "public/motion/too-large.json",
        content: Buffer.alloc(3 * 1024 * 1024 + 1, 0x61)
      }
    ]);
    await writeStoredZip(oversizedContentsZip, [
      { name: "public/motion/a.json", content: threeMiB },
      { name: "public/motion/b.json", content: threeMiB },
      { name: "public/motion/c.json", content: threeMiB }
    ]);
    await writeStoredZip(oversizedArchiveZip, [
      { name: "public/motion/a.json", content: threeMiB },
      { name: "public/motion/b.json", content: threeMiB },
      { name: "public/motion/c.json", content: threeMiB },
      { name: "public/motion/d.json", content: threeMiB }
    ]);

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", oversizedEntryZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Source package entry exceeds")
    });
    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", oversizedContentsZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Source package contents exceed")
    });
    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", oversizedArchiveZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Source package archive exceeds")
    });
  });

  it("audits source package manifest entries against the real zip entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-manifest-audit-"));
    const mismatchZip = join(directory, "mismatch.zip");
    const cleanZip = join(directory, "clean.zip");
    const cleanManifest = {
      packageType: "source",
      files: [
        { path: "package.json", bytes: 2, sha256: sha256("{}") },
        { path: "src/main.tsx", bytes: 2, sha256: sha256("ok") }
      ]
    };

    await writeStoredZip(mismatchZip, [
      { name: "package.json", content: "{}" },
      { name: "src/main.tsx", content: "ok" },
      {
        name: "SOURCE_PACKAGE_MANIFEST.json",
        content: JSON.stringify({ packageType: "source", files: cleanManifest.files.slice(0, 1) })
      }
    ]);
    await writeStoredZip(cleanZip, [
      { name: "package.json", content: "{}" },
      { name: "src/main.tsx", content: "ok" },
      {
        name: "SOURCE_PACKAGE_MANIFEST.json",
        content: JSON.stringify(cleanManifest)
      }
    ]);

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", mismatchZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Manifest mismatch")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", cleanZip], {
        cwd: projectRoot
      })
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Package audit passed")
    });
  });

  it("rejects nested forbidden source package entries at any directory depth", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-nested-forbidden-"));
    const badZip = join(directory, "bad.zip");
    await writeStoredZip(badZip, [
      { name: "aleksi-learning-workbench/node_modules/vite/index.js", content: "bad" },
      { name: "project/test-results/.last-run.json", content: "bad" },
      { name: "foo/dist/assets/index.js", content: "bad" },
      { name: "foo/AleksiWorkbench-Preview/runtime/node.exe", content: "bad" },
      { name: "foo/logs/latest.log", content: "bad" },
      { name: "foo/runtime.pid", content: "bad" }
    ]);

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", badZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("node_modules/")
    });
  });

  it("rejects duplicate entries, duplicate source manifests, unsafe names, and sha mismatches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-hard-audit-"));
    const duplicateEntryZip = join(directory, "duplicate-entry.zip");
    const duplicateManifestZip = join(directory, "duplicate-manifest.zip");
    const unsafeNamesZip = join(directory, "unsafe-names.zip");
    const shaMismatchZip = join(directory, "sha-mismatch.zip");

    await writeStoredZip(duplicateEntryZip, [
      { name: "package.json", content: "{}" },
      { name: "package.json", content: "{}" }
    ]);
    await writeStoredZip(duplicateManifestZip, [
      { name: "package.json", content: "{}" },
      {
        name: "SOURCE_PACKAGE_MANIFEST.json",
        content: JSON.stringify({ packageType: "source", files: [{ path: "package.json", bytes: 2, sha256: "x" }] })
      },
      {
        name: "SOURCE_PACKAGE_MANIFEST.json",
        content: JSON.stringify({ packageType: "source", files: [{ path: "package.json", bytes: 2, sha256: "x" }] })
      }
    ]);
    await writeStoredZip(unsafeNamesZip, [
      { name: "/absolute/path.txt", content: "bad" },
      { name: "../escape.txt", content: "bad" },
      { name: "folder\\windows.txt", content: "bad" },
      { name: "", content: "bad" }
    ]);
    await writeStoredZip(shaMismatchZip, [
      { name: "package.json", content: "{}" },
      {
        name: "SOURCE_PACKAGE_MANIFEST.json",
        content: JSON.stringify({
          packageType: "source",
          files: [{ path: "package.json", bytes: 2, sha256: "not-the-real-sha" }]
        })
      }
    ]);

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", duplicateEntryZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Duplicate source package entries")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", duplicateManifestZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("SOURCE_PACKAGE_MANIFEST.json must appear exactly once")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", unsafeNamesZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Unsafe package entry")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-package.mjs", shaMismatchZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("sha256")
    });
  });

  it("creates an idempotent source package with exactly one generated manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-source-idempotent-"));
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(join(directory, "package.json"), "{\"name\":\"fixture\"}\n");
    await writeFile(join(directory, "src", "main.ts"), "export const ok = true;\n");
    await writeFile(join(directory, "SOURCE_PACKAGE_MANIFEST.json"), "{\"stale\":true}\n");
    await writeFile(join(directory, "RUNTIME_MANIFEST.json"), "{\"stale\":true}\n");

    await expect(
      execFileAsync("node", [join(projectRoot, "scripts/package-source.mjs")], {
        cwd: directory
      })
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Created source package")
    });
    await expect(
      execFileAsync("node", [
        join(projectRoot, "scripts/audit-package.mjs"),
        join(directory, "artifacts/aleksi-learning-workbench-source.zip")
      ])
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Package audit passed")
    });

    const entries = await readStoredZip(join(directory, "artifacts/aleksi-learning-workbench-source.zip"));
    const names = entries.map((entry) => entry.name);
    const manifestEntries = entries.filter((entry) => entry.name === "SOURCE_PACKAGE_MANIFEST.json");
    const manifest = JSON.parse(manifestEntries[0].content.toString("utf8")) as {
      files: Array<{ path: string }>;
    };

    expect(manifestEntries).toHaveLength(1);
    expect(names).not.toContain("RUNTIME_MANIFEST.json");
    expect(manifest.files.map((file) => file.path)).not.toContain("SOURCE_PACKAGE_MANIFEST.json");
    expect(manifest.files.map((file) => file.path)).not.toContain("RUNTIME_MANIFEST.json");
  });

  it("audits runtime package contents against the portable runtime boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-runtime-audit-"));
    const badZip = join(directory, "bad-runtime.zip");
    const fontStubZip = join(directory, "font-stub-runtime.zip");
    const fontPathTextZip = join(directory, "font-path-text-runtime.zip");
    const renamedFontZip = join(directory, "renamed-font-runtime.zip");
    const embeddedFontFaceZip = join(directory, "embedded-font-face-runtime.zip");
    const disguisedFontStubZip = join(directory, "disguised-font-stub-runtime.zip");
    const katexFontZip = join(directory, "katex-font-runtime.zip");
    const hashMismatchZip = join(directory, "hash-mismatch-runtime.zip");
    const cleanZip = join(directory, "clean-runtime.zip");
    const cleanEntries = [
      { name: "AleksiWorkbench-Preview/Start Aleksi Workbench.cmd", content: "@echo off\r\n" },
      { name: "AleksiWorkbench-Preview/Start Aleksi Workbench.ps1", content: "param()\n" },
      { name: "AleksiWorkbench-Preview/Stop Aleksi Workbench.cmd", content: "@echo off\r\n" },
      { name: "AleksiWorkbench-Preview/Stop Aleksi Workbench.ps1", content: "param()\n" },
      { name: "AleksiWorkbench-Preview/README_START.txt", content: "Double-click Start Aleksi Workbench.cmd\n" },
      { name: "AleksiWorkbench-Preview/runtime/node.exe", content: "node" },
      { name: "AleksiWorkbench-Preview/app/server.cjs", content: "console.log('runtime')\n" },
      { name: "AleksiWorkbench-Preview/app/dist/index.html", content: "<div id=\"root\"></div>\n" },
      { name: "AleksiWorkbench-Preview/logs/.gitkeep", content: "" },
      { name: "AleksiWorkbench-Preview/data/.gitkeep", content: "" }
    ];

    await writeStoredZip(badZip, [
      ...cleanEntries,
      runtimeManifestEntry(cleanEntries),
      { name: "src/main.tsx", content: "bad" },
      { name: "node_modules/vite/bin/vite.js", content: "bad" },
      { name: "AleksiWorkbench-Preview/app/dist/fonts/claude/fake.ttf", content: "fake" }
    ]);
    await writeStoredZip(cleanZip, [
      ...cleanEntries,
      runtimeManifestEntry(cleanEntries)
    ]);
    const hashMismatchEntries = cleanEntries.map((entry) =>
      entry.name.endsWith("app/server.cjs")
        ? { ...entry, content: entry.content.replace("runtime", "RUNTIME") }
        : entry
    );
    await writeStoredZip(hashMismatchZip, [
      ...hashMismatchEntries,
      runtimeManifestEntry(cleanEntries)
    ]);
    const fontStubEntries = [
      ...cleanEntries,
      { name: "AleksiWorkbench-Preview/app/dist/fonts/claude/fake.ttf", content: "fake" }
    ];
    await writeStoredZip(fontStubZip, [
      ...fontStubEntries,
      runtimeManifestEntry(fontStubEntries)
    ]);
    const fontPathTextEntries = [
      ...cleanEntries,
      {
        name: "AleksiWorkbench-Preview/app/dist/assets/index.css",
        content: '@font-face { src: url("/Fonts/Claude/c66fc489e-C-BHYa_K.ttf"); }'
      }
    ];
    await writeStoredZip(fontPathTextZip, [
      ...fontPathTextEntries,
      runtimeManifestEntry(fontPathTextEntries)
    ]);
    const renamedFontEntries = [
      ...cleanEntries,
      {
        name: "AleksiWorkbench-Preview/app/dist/assets/private-renamed.woff2",
        content: "private font"
      }
    ];
    await writeStoredZip(renamedFontZip, [
      ...renamedFontEntries,
      runtimeManifestEntry(renamedFontEntries)
    ]);
    const embeddedFontFaceEntries = [
      ...cleanEntries,
      {
        name: "AleksiWorkbench-Preview/app/dist/assets/embedded.css",
        content:
          '@font-face{font-family:PrivateFont;src:url("data:font/woff2;base64,AAAA")}'
      }
    ];
    await writeStoredZip(embeddedFontFaceZip, [
      ...embeddedFontFaceEntries,
      runtimeManifestEntry(embeddedFontFaceEntries)
    ]);
    const disguisedFontStubEntries = [
      ...cleanEntries,
      {
        name:
          "AleksiWorkbench-Preview/app/dist/assets/KaTeX_Main-Regular-fake.woff2",
        content: "private font stub"
      }
    ];
    await writeStoredZip(disguisedFontStubZip, [
      ...disguisedFontStubEntries,
      runtimeManifestEntry(disguisedFontStubEntries)
    ]);
    const katexFontContent = await readFile(
      join(projectRoot, "node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2")
    );
    const katexFontEntries = [
      ...cleanEntries,
      {
        name:
          "AleksiWorkbench-Preview/app/dist/assets/KaTeX_Main-Regular-safe.woff2",
        content: katexFontContent
      },
      {
        name: "AleksiWorkbench-Preview/app/dist/assets/katex.css",
        content:
          '@font-face{font-family:KaTeX_Main;src:url("/assets/KaTeX_Main-Regular-safe.woff2")}'
      }
    ];
    await writeStoredZip(katexFontZip, [
      ...katexFontEntries,
      runtimeManifestEntry(katexFontEntries)
    ]);

    await expect(
      execFileAsync("node", ["scripts/audit-runtime.mjs", badZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Forbidden runtime package entry")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-runtime.mjs", fontStubZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("app/dist/fonts/claude/")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-runtime.mjs", fontPathTextZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Forbidden runtime package text")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-runtime.mjs", renamedFontZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("non-KaTeX font binary")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-runtime.mjs", embeddedFontFaceZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("non-KaTeX @font-face")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-runtime.mjs", disguisedFontStubZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unknown KaTeX font content")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-runtime.mjs", hashMismatchZip], {
        cwd: projectRoot
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("sha256")
    });

    await expect(
      execFileAsync("node", ["scripts/audit-runtime.mjs", cleanZip], {
        cwd: projectRoot
      })
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Runtime package audit passed")
    });
    await expect(
      execFileAsync("node", ["scripts/audit-runtime.mjs", katexFontZip], {
        cwd: projectRoot
      })
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Runtime package audit passed")
    });
  });

  it("registers delivery-blocking technical debt and the packaging roadmap", async () => {
    const register = await readProjectFile("docs/current/TECH_DEBT_REGISTER.md");
    const roadmap = await readProjectFile("docs/current/PACKAGING_ROADMAP.md");

    expect(register).toContain("TD-P0-001");
    expect(register).toContain("TD-P1-001");
    expect(register).toContain("TD-P2-001");
    expect(register).toContain("TD-P2-003");
    expect(register).toContain("全量卡片库");
    expect(register).toContain("搜索/筛选");
    expect(register).toContain("surface-static");
    expect(register).toContain("surface-interactive");
    expect(register).toContain("reader-paper");
    expect(register).toContain("input-surface");
    expect(register).toContain("shell-panel");
    expect(register).toContain("阻断交付");
    expect(roadmap).toContain("source package");
    expect(roadmap).toContain("runtime package");
    expect(roadmap).toContain("Windows Desktop Verification Preview");
    expect(roadmap).toContain("NSIS");
  });

  it("uses the friend preview artifact name, launcher copy, manifest path, and runtime port range", async () => {
    const packageJson = JSON.parse(await readProjectFile("package.json")) as {
      scripts: Record<string, string>;
    };
    const runtimeRules = await readProjectFile("scripts/runtime-package-rules.mjs");
    const runtimePackager = await readProjectFile("scripts/package-runtime.mjs");
    const runtimeVerifier = await readProjectFile("scripts/verify-runtime.mjs");
    const runtimeBuilder = await readProjectFile("scripts/build-runtime.mjs");

    expect(packageJson.scripts["audit:runtime"]).toContain(
      "artifacts/AleksiWorkbench-Preview-win-x64.zip"
    );
    expect(runtimeRules).toContain('RUNTIME_PACKAGE_NAME = "AleksiWorkbench-Preview-win-x64"');
    expect(runtimeRules).toContain('RUNTIME_ARCHIVE_ROOT = "AleksiWorkbench-Preview"');
    expect(runtimeRules).toContain('RUNTIME_MANIFEST_NAME = "app/runtime-manifest.json"');
    expect(runtimeRules).toContain("Start Aleksi Workbench.cmd");

    expect(runtimePackager).toContain("Aleksi Learning Workbench Preview");
    expect(runtimePackager).toContain("Double-click");
    expect(runtimePackager).toContain("Start Aleksi Workbench.cmd");
    expect(runtimePackager).toContain("Stop Aleksi Workbench.cmd");
    expect(runtimePackager).toContain("17817");
    expect(runtimePackager).toContain("17880");
    expect(runtimePackager).toContain("chcp 65001");
    expect(runtimePackager).toContain("[Console]::InputEncoding");
    expect(runtimePackager).toContain("[Console]::OutputEncoding");
    expect(runtimePackager).toContain("$OutputEncoding");
    expect(runtimePackager).toContain("$env:PYTHONUTF8 = '1'");
    expect(runtimePackager).toContain("$env:PYTHONIOENCODING = 'utf-8'");
    expect(runtimePackager).toContain("[int]$HealthWaitSeconds = 60");
    expect(runtimePackager).toContain("AddSeconds($HealthWaitSeconds)");
    expect(runtimePackager).toContain("Invoke-RestMethod -Uri $HealthUrl");
    expect(runtimePackager).toContain("$Response.ok -ne $true");
    expect(runtimePackager).toContain("$Response.service -ne 'aleksi-workbench'");
    expect(runtimePackager).toContain("$Response.version -ne $AppVersion");
    expect(runtimePackager).toContain("$Response.buildId -ne $BuildId");
    expect(runtimePackager).toContain("$env:ALEKSI_APP_VERSION = $AppVersion");
    expect(runtimePackager).toContain("$env:ALEKSI_BUILD_ID = $BuildId");
    expect(runtimePackager).toContain("$env:ALEKSI_RUNTIME_LOG_DIR = $Logs");
    expect(runtimePackager).toContain("version = $AppVersion");
    expect(runtimePackager).toContain("buildId = $BuildId");
    expect(runtimePackager).toContain("[guid]::NewGuid().ToString('N')");
    expect(runtimePackager).toContain("?launch=");
    expect(runtimePackager).toContain("AddDays(-30)");
    expect(runtimePackager).toContain("'^\\\\d{4}-\\\\d{2}-\\\\d{2}\\\\.log$'");
    expect(runtimePackager).toContain("createRuntimeContentBuildId");
    expect(runtimePackager).toContain("[string]$ServerErrorText = Get-Content");
    expect(runtimePackager).toContain("[string]::IsNullOrWhiteSpace($ServerErrorText)");
    expect(runtimePackager).toContain("$Process.HasExited");
    expect(runtimePackager).toContain("runtime.instance.json");
    expect(runtimePackager).toContain("runtime.launch.lock");
    expect(runtimePackager).toContain("Get-HealthyRuntime");
    expect(runtimePackager).toContain("healthy existing runtime reused");
    expect(runtimePackager).toContain("Get-CimInstance Win32_Process");
    expect(runtimePackager).toContain("StartTime.ToUniversalTime().ToString('o')");
    expect(runtimePackager).toContain("server exited before health check passed");
    expect(runtimePackager).toContain("$Process.WaitForExit() | Out-Null");
    expect(runtimePackager).not.toContain("exit code $ServerExitCode");
    expect(runtimePackager).toContain("Stop-Process -InputObject $Process -Force");
    expect(runtimePackager).toContain("Start-Process -FilePath $Node");
    expect(runtimePackager).toContain("-RedirectStandardOutput $ServerOut");
    expect(runtimePackager).toContain("-RedirectStandardError $ServerErr");
    expect(runtimePackager).not.toContain("taskkill.exe /PID $Process.Id");
    expect(runtimePackager).not.toContain("Start-Process -FilePath $env:ComSpec");
    expect(runtimePackager).toContain("sanitizeFriendPreviewDist");
    expect(runtimeRules).toContain("RUNTIME_FORBIDDEN_TEXT_SUBSTRINGS");
    expect(runtimePackager).toContain("Documents");
    expect(runtimePackager).not.toContain("start-runtime.cmd");
    expect(runtimePackager).not.toContain("5174");

    expect(runtimeVerifier).toContain("RUNTIME_ARCHIVE_ROOT");
    expect(runtimeVerifier).toContain("Start Aleksi Workbench.ps1");
    expect(runtimeVerifier).toContain("Stop Aleksi Workbench.ps1");
    expect(runtimeVerifier).toContain("Repeated launch created a second runtime");
    expect(runtimeVerifier).toContain("Runtime health identity mismatch");
    expect(runtimeVerifier).toContain("Runtime instance identity mismatch");
    expect(runtimeVerifier).toContain("Expired date log was not removed");
    expect(runtimeVerifier).toContain("logs/YYYY-MM-DD.log");
    expect(runtimeVerifier).not.toContain('encoding: "utf8"');
    expect(runtimeVerifier.match(/stdio: "inherit"/gu)).toHaveLength(4);
    expect(runtimeVerifier).not.toContain("toISOString().slice(0, 10)");
    expect(runtimeVerifier).not.toContain("-Port");
    expect(runtimeBuilder).toContain('format: "cjs"');
  });

  it("keeps clean-base verification wired to source health", async () => {
    const verifyScript = await readProjectFile("scripts/verify-clean-base.mjs");

    expect(verifyScript).toContain('runStep("npm run health:source"');
    expect(verifyScript).toContain("已完成基础：V0.2 clean source package");
    expect(verifyScript).toContain("Friend Preview Portable Runtime v0.1");
    expect(verifyScript).toContain("当前交付：Windows Desktop Verification Preview");
    expect(verifyScript).toContain("Aleksi-Workbench-Setup.exe");
    expect(verifyScript).toContain("runtime package 只能证明该便携包");
    expect(verifyScript).not.toContain("当前阶段不推进 runtime");
    expect(verifyScript.indexOf('runStep("npm run package:audit"')).toBeLessThan(
      verifyScript.indexOf('runStep("npm run health:source"')
    );
    expect(verifyScript.indexOf('runStep("npm run health:source"')).toBeLessThan(
      verifyScript.indexOf("await verifyDocs();")
    );
  });

  it("does not ship a production demo learning library", async () => {
    await expect(stat(join(projectRoot, "demo-vault-template"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    const runtimeRules = await readProjectFile("scripts/runtime-package-rules.mjs");
    expect(runtimeRules).not.toContain("demo-vault-template");
  });

  it("copies private-local Claude fonts only from a user-provided local source", async () => {
    const source = await mkdtemp(join(tmpdir(), "aleksi-local-font-source-"));
    const targetRoot = await mkdtemp(join(tmpdir(), "aleksi-local-font-target-"));
    const expectedFonts = [
      "c66fc489e-C-BHYa_K.ttf",
      "cc27851ad-CFxw3nG7.ttf",
      "c5dbe0935-B88FVziN.ttf",
      "NotoSerifSC-VariableFont_wght.ttf",
      "NotoSansSC-VariableFont_wght.ttf",
      "SourceHanSansSC-Regular.otf",
      "SourceHanSansSC-Bold.otf"
    ];

    for (const filename of expectedFonts) {
      await writeFile(join(source, filename), `font:${filename}`);
    }

    const script = await readProjectFile("scripts/copy-claude-fonts.mjs");
    expect(script).not.toContain("https://");
    expect(script).not.toContain("http://");
    expect(script).toContain("public/fonts/claude");

    await expect(
      execFileAsync(
        "node",
        [join(projectRoot, "scripts/copy-claude-fonts.mjs"), source],
        {
          cwd: targetRoot
        }
      )
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Copied 7 Claude font files")
    });

    for (const filename of expectedFonts) {
      await expect(stat(join(targetRoot, "public/fonts/claude", filename))).resolves.toMatchObject({
        size: expect.any(Number)
      });
    }
  });

  it("keeps README learning-library guidance aligned with the dynamic Settings recommendation", async () => {
    const readme = await readProjectFile("README.md");

    expect(readme).toContain("桌面态首次启动会建议当前 Windows 用户的默认位置");
    expect(readme).toContain("C:\\Users\\<you>\\Documents\\Aleksi Learning Workbench");
    expect(readme).not.toContain("C:\\Users\\pcp\\Documents\\Aleksi-Learning-Vault");
    expect(readme).not.toContain("C:\\Users\\pcp\\Desktop\\aleksi-learning-workbench");
  });

  it("documents private-local font usage without tracking Claude font binaries", async () => {
    const gitignore = await readProjectFile(".gitignore");
    const policy = await readProjectFile("docs/current/FONT_USAGE_POLICY.md");

    expect(gitignore).toContain(".runtime-debug/");
    expect(gitignore).toContain("public/fonts/claude/");
    expect(policy).toContain("private-local");
    expect(policy).toContain("public/fonts/claude");
    expect(policy).toContain("Do not download");
    expect(policy).toContain("Do not commit");
  });
});
