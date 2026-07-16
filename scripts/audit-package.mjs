#!/usr/bin/env node
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  findForbiddenPackageEntry,
  normalizePackageEntryName,
  SOURCE_MANIFEST_NAME,
  SOURCE_PACKAGE_MAX_ARCHIVE_BYTES,
  SOURCE_PACKAGE_MAX_ENTRY_BYTES,
  SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES,
  SOURCE_PACKAGE_PATH
} from "./package-rules.mjs";
import { readStoredEntryData, readZipEntries } from "./zip-store.mjs";

function validateRawEntryName(name) {
  if (name.length === 0) {
    return "empty entry name";
  }

  if (name.includes("\\")) {
    return "backslash path separator";
  }

  if (name.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(name)) {
    return "absolute path";
  }

  const parts = name.split("/");
  if (parts.includes("..")) {
    return "parent directory segment";
  }

  return null;
}

function compareSourceManifest(archive, entries) {
  const manifestEntries = entries.filter(
    (entry) => normalizePackageEntryName(entry.name) === SOURCE_MANIFEST_NAME
  );

  if (manifestEntries.length > 1) {
    throw new Error(`${SOURCE_MANIFEST_NAME} must appear exactly once`);
  }

  const manifestEntry = manifestEntries[0];
  if (!manifestEntry) {
    return;
  }

  const manifest = JSON.parse(readStoredEntryData(archive, manifestEntry).toString("utf8"));
  if (manifest.packageType !== "source" || !Array.isArray(manifest.files)) {
    throw new Error("Manifest mismatch: source manifest is missing packageType/source files");
  }

  const expected = new Map();
  for (const file of manifest.files) {
    expected.set(normalizePackageEntryName(file.path), {
      bytes: Number(file.bytes),
      sha256: String(file.sha256)
    });
  }

  const actual = new Map();
  for (const entry of entries) {
    const name = normalizePackageEntryName(entry.name);
    if (name === SOURCE_MANIFEST_NAME || name.endsWith("/")) {
      continue;
    }
    const data = readStoredEntryData(archive, entry);
    actual.set(name, {
      bytes: entry.uncompressedSize,
      sha256: createHash("sha256").update(data).digest("hex")
    });
  }

  const expectedNames = [...expected.keys()].sort();
  const actualNames = [...actual.keys()].sort();
  const missing = expectedNames.filter((name) => !actual.has(name));
  const extra = actualNames.filter((name) => !expected.has(name));
  const sizeMismatches = expectedNames.filter(
    (name) => actual.has(name) && actual.get(name).bytes !== expected.get(name).bytes
  );
  const hashMismatches = expectedNames.filter(
    (name) => actual.has(name) && actual.get(name).sha256 !== expected.get(name).sha256
  );

  if (
    missing.length > 0 ||
    extra.length > 0 ||
    sizeMismatches.length > 0 ||
    hashMismatches.length > 0
  ) {
    throw new Error(
      [
        "Manifest mismatch:",
        missing.length > 0 ? `missing=${missing.join(",")}` : null,
        extra.length > 0 ? `extra=${extra.join(",")}` : null,
        sizeMismatches.length > 0 ? `size=${sizeMismatches.join(",")}` : null,
        hashMismatches.length > 0 ? `sha256=${hashMismatches.join(",")}` : null
      ].filter(Boolean).join(" ")
    );
  }
}

export async function auditZipFile(zipPath) {
  const { archive, entries } = await readZipEntries(zipPath);
  const seen = new Set();
  const duplicateEntries = [];
  const unsafeEntries = [];
  const forbidden = [];
  const sourceManifestCount = entries.filter(
    (entry) => normalizePackageEntryName(entry.name) === SOURCE_MANIFEST_NAME
  ).length;
  const totalUncompressedBytes = entries.reduce(
    (total, entry) => total + entry.uncompressedSize,
    0
  );

  if (archive.length > SOURCE_PACKAGE_MAX_ARCHIVE_BYTES) {
    throw new Error(
      `Source package archive exceeds ${SOURCE_PACKAGE_MAX_ARCHIVE_BYTES} bytes: ${archive.length}`
    );
  }

  if (totalUncompressedBytes > SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Source package contents exceed ${SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES} bytes: ${totalUncompressedBytes}`
    );
  }

  const oversizedEntries = entries.filter(
    (entry) => entry.uncompressedSize > SOURCE_PACKAGE_MAX_ENTRY_BYTES
  );
  if (oversizedEntries.length > 0) {
    throw new Error(
      oversizedEntries
        .map(
          (entry) =>
            `Source package entry exceeds ${SOURCE_PACKAGE_MAX_ENTRY_BYTES} bytes: ${normalizePackageEntryName(entry.name)} (${entry.uncompressedSize})`
        )
        .join("\n")
    );
  }

  for (const entry of entries) {
    const unsafeReason = validateRawEntryName(entry.name);
    const normalized = normalizePackageEntryName(entry.name);

    if (unsafeReason !== null) {
      unsafeEntries.push({ entry: entry.name, reason: unsafeReason });
    }

    if (seen.has(normalized)) {
      duplicateEntries.push(normalized);
    }
    seen.add(normalized);

    const match = findForbiddenPackageEntry(normalized);
    if (match !== null) {
      forbidden.push({ entry: normalized, match });
    }
  }

  if (unsafeEntries.length > 0) {
    const details = unsafeEntries
      .map(({ entry, reason }) => `Unsafe package entry: ${entry} (${reason})`)
      .join("\n");
    throw new Error(details);
  }

  if (sourceManifestCount > 1) {
    throw new Error(`${SOURCE_MANIFEST_NAME} must appear exactly once`);
  }

  if (duplicateEntries.length > 0) {
    throw new Error(`Duplicate source package entries: ${duplicateEntries.join(",")}`);
  }

  if (forbidden.length > 0) {
    const details = forbidden
      .map(({ entry, match }) => `Forbidden package entry: ${entry} matched ${match}`)
      .join("\n");
    throw new Error(details);
  }

  compareSourceManifest(archive, entries);

  return {
    entries: entries.length,
    totalUncompressedBytes
  };
}

async function main() {
  const zipPath = process.argv[2] ?? SOURCE_PACKAGE_PATH;
  try {
    const result = await auditZipFile(zipPath);
    console.log(
      `Package audit passed: ${result.entries} entries, ${result.totalUncompressedBytes} bytes`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
