#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { auditZipFile } from "./audit-package.mjs";
import {
  FORBIDDEN_DIRECTORY_PREFIXES,
  FORBIDDEN_ENTRY_SUBSTRINGS,
  FORBIDDEN_EXACT_ENTRIES,
  FORBIDDEN_FILE_NAMES,
  FORBIDDEN_FILE_SUFFIXES,
  FORBIDDEN_LOCAL_ENV_PATTERN,
  SOURCE_MANIFEST_NAME,
  SOURCE_PACKAGE_PATH,
  normalizePackageEntryName,
  shouldIncludeSourceEntry
} from "./package-rules.mjs";
import { writeStoredZip } from "./zip-store.mjs";

const root = process.cwd();

async function collectSourceFiles(directory = root) {
  const entries = [];
  const children = await readdir(directory, { withFileTypes: true });

  for (const child of children) {
    const absolutePath = resolve(directory, child.name);
    const relativePath = normalizePackageEntryName(relative(root, absolutePath));

    if (!shouldIncludeSourceEntry(relativePath)) {
      continue;
    }

    if (child.isDirectory()) {
      entries.push(...await collectSourceFiles(absolutePath));
      continue;
    }

    if (child.isFile()) {
      entries.push({ absolutePath, relativePath });
    }
  }

  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function main() {
  const outputPath = resolve(root, process.argv[2] ?? SOURCE_PACKAGE_PATH);
  const files = await collectSourceFiles();
  const packageEntries = [];
  const manifestFiles = [];

  for (const file of files) {
    const data = await readFile(file.absolutePath);
    const information = await stat(file.absolutePath);
    packageEntries.push({ name: file.relativePath, data });
    manifestFiles.push({
      path: file.relativePath,
      bytes: information.size,
      sha256: createHash("sha256").update(data).digest("hex")
    });
  }

  const manifest = {
    schemaVersion: 1,
    packageType: "source",
    generatedAtUtc: new Date().toISOString(),
    packagePath: normalizePackageEntryName(relative(root, outputPath)),
    excludes: {
      directoryPrefixes: FORBIDDEN_DIRECTORY_PREFIXES,
      entrySubstrings: FORBIDDEN_ENTRY_SUBSTRINGS,
      exactEntries: FORBIDDEN_EXACT_ENTRIES,
      fileNames: FORBIDDEN_FILE_NAMES,
      fileSuffixes: FORBIDDEN_FILE_SUFFIXES,
      localEnvFiles: FORBIDDEN_LOCAL_ENV_PATTERN
    },
    files: manifestFiles
  };

  packageEntries.push({
    name: SOURCE_MANIFEST_NAME,
    data: `${JSON.stringify(manifest, null, 2)}\n`
  });

  await writeStoredZip(outputPath, packageEntries);
  const audit = await auditZipFile(outputPath);
  console.log(
    `Created source package: ${outputPath} (${audit.entries} entries, ${audit.totalUncompressedBytes} bytes)`
  );
}

await main();
