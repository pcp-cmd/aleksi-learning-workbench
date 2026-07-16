#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createRuntimeContentBuildId,
  findForbiddenRuntimeEntry,
  normalizeRuntimeEntryName,
  runtimeArchiveEntryName,
  RUNTIME_MANIFEST_NAME,
  RUNTIME_PACKAGE_PATH,
  RUNTIME_FORBIDDEN_TEXT_SUBSTRINGS,
  RUNTIME_IDENTITY_VALUE_PATTERN,
  RUNTIME_REQUIRED_RELATIVE_ENTRIES,
  stripRuntimeArchiveRoot
} from "./runtime-package-rules.mjs";
import { readStoredEntryData, readZipEntries } from "./zip-store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const katexFontDirectory = resolve(root, "node_modules/katex/dist/fonts");

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function readKnownKatexFontHashes() {
  const names = await readdir(katexFontDirectory);
  const fonts = names.filter((name) => /\.(?:ttf|woff2?)$/iu.test(name));
  return new Set(
    await Promise.all(
      fonts.map(async (name) =>
        sha256(await readFile(resolve(katexFontDirectory, name)))
      )
    )
  );
}

function compareRuntimeManifest(archive, entries) {
  const manifestEntry = entries.find(
    (entry) => normalizeRuntimeEntryName(entry.name) === runtimeArchiveEntryName(RUNTIME_MANIFEST_NAME)
  );
  if (!manifestEntry) {
    throw new Error(`Missing runtime manifest: ${RUNTIME_MANIFEST_NAME}`);
  }

  const manifest = JSON.parse(readStoredEntryData(archive, manifestEntry).toString("utf8"));
  if (manifest.packageType !== "runtime" || !Array.isArray(manifest.files)) {
    throw new Error("Runtime manifest mismatch: missing packageType/runtime files");
  }
  if (
    !RUNTIME_IDENTITY_VALUE_PATTERN.test(String(manifest.version)) ||
    !RUNTIME_IDENTITY_VALUE_PATTERN.test(String(manifest.buildId))
  ) {
    throw new Error("Runtime manifest mismatch: invalid version/buildId");
  }

  const buildInputs = entries.flatMap((entry) => {
    const path = stripRuntimeArchiveRoot(entry.name);
    if (path === null || path.endsWith("/")) {
      return [];
    }
    return [{ path, data: readStoredEntryData(archive, entry) }];
  });
  const expectedBuildId = createRuntimeContentBuildId(buildInputs);
  if (manifest.buildId !== expectedBuildId) {
    throw new Error(
      `Runtime manifest mismatch: buildId expected ${expectedBuildId} but found ${manifest.buildId}`
    );
  }

  const expected = new Map();
  for (const file of manifest.files) {
    expected.set(normalizeRuntimeEntryName(file.path), {
      bytes: Number(file.bytes),
      sha256: String(file.sha256)
    });
  }

  const actual = new Map();
  for (const entry of entries) {
    const name = stripRuntimeArchiveRoot(entry.name);
    if (name === null || name === RUNTIME_MANIFEST_NAME || name.endsWith("/")) {
      continue;
    }
    const data = readStoredEntryData(archive, entry);
    actual.set(name, {
      bytes: entry.uncompressedSize,
      sha256: sha256(data)
    });
  }

  const expectedNames = [...expected.keys()].sort();
  const actualNames = [...actual.keys()].sort();
  const missing = expectedNames.filter((name) => !actual.has(name));
  const extra = actualNames.filter((name) => !expected.has(name));
  const sizeMismatches = expectedNames.filter(
    (name) =>
      actual.has(name) && actual.get(name).bytes !== expected.get(name).bytes
  );
  const hashMismatches = expectedNames.filter(
    (name) =>
      actual.has(name) && actual.get(name).sha256 !== expected.get(name).sha256
  );

  if (
    missing.length > 0 ||
    extra.length > 0 ||
    sizeMismatches.length > 0 ||
    hashMismatches.length > 0
  ) {
    throw new Error(
      [
        "Runtime manifest mismatch:",
        missing.length > 0 ? `missing=${missing.join(",")}` : null,
        extra.length > 0 ? `extra=${extra.join(",")}` : null,
        sizeMismatches.length > 0 ? `size=${sizeMismatches.join(",")}` : null,
        hashMismatches.length > 0
          ? `sha256=${hashMismatches.join(",")}`
          : null
      ].filter(Boolean).join(" ")
    );
  }
}

function isRuntimeTextAsset(entryName) {
  return /\.(css|html|js|json|mjs|txt|cmd|ps1)$/iu.test(entryName);
}

function isRuntimeStyleAsset(entryName) {
  return /\.(css|html)$/iu.test(entryName);
}

function isRuntimeFontAsset(entryName) {
  return /\.(?:ttf|woff2?)$/iu.test(entryName);
}

function containsForbiddenFontFace(text) {
  const fontFaces = text.match(/@font-face\s*\{[^{}]*\}/giu) ?? [];
  const allowedKatexFamily =
    /font-family\s*:\s*["']?KaTeX_(?:AMS|Caligraphic|Fraktur|Main|Math|SansSerif|Script|Size[1-4]|Typewriter)(?:["';\s]|$)/iu;

  return fontFaces.some((fontFace) => !allowedKatexFamily.test(fontFace));
}

export async function auditRuntimeZipFile(zipPath) {
  const { archive, entries } = await readZipEntries(zipPath);
  const seen = new Set();
  const duplicateEntries = [];
  const forbiddenEntries = [];
  const forbiddenTextEntries = [];
  let knownKatexFontHashes;

  for (const entry of entries) {
    const normalized = normalizeRuntimeEntryName(entry.name);
    if (seen.has(normalized)) {
      duplicateEntries.push(normalized);
    }
    seen.add(normalized);

    const match = findForbiddenRuntimeEntry(entry.name);
    if (match !== null) {
      forbiddenEntries.push({ entry: normalized, match });
    } else if (isRuntimeFontAsset(normalized)) {
      knownKatexFontHashes ??= await readKnownKatexFontHashes();
      const digest = sha256(readStoredEntryData(archive, entry));
      if (!knownKatexFontHashes.has(digest)) {
        forbiddenEntries.push({
          entry: normalized,
          match: "unknown KaTeX font content"
        });
      }
    }

    if (isRuntimeTextAsset(normalized)) {
      const text = readStoredEntryData(archive, entry).toString("utf8");
      const comparableText = text.toLowerCase();
      const textMatch = RUNTIME_FORBIDDEN_TEXT_SUBSTRINGS.find((substring) =>
        comparableText.includes(substring.toLowerCase())
      );
      if (textMatch !== undefined) {
        forbiddenTextEntries.push({ entry: normalized, match: textMatch });
      } else if (
        isRuntimeStyleAsset(normalized) &&
        containsForbiddenFontFace(text)
      ) {
        forbiddenTextEntries.push({
          entry: normalized,
          match: "non-KaTeX @font-face"
        });
      }
    }
  }

  if (duplicateEntries.length > 0) {
    throw new Error(`Duplicate runtime package entries: ${duplicateEntries.join(",")}`);
  }

  if (forbiddenEntries.length > 0) {
    const details = forbiddenEntries
      .map(({ entry, match }) => `Forbidden runtime package entry: ${entry} matched ${match}`)
      .join("\n");
    throw new Error(details);
  }

  if (forbiddenTextEntries.length > 0) {
    const details = forbiddenTextEntries
      .map(({ entry, match }) => `Forbidden runtime package text: ${entry} matched ${match}`)
      .join("\n");
    throw new Error(details);
  }

  const entryNames = new Set(entries.map((entry) => normalizeRuntimeEntryName(entry.name)));
  const missingRequiredEntries = RUNTIME_REQUIRED_RELATIVE_ENTRIES
    .map((entry) => runtimeArchiveEntryName(entry))
    .filter((entry) => !entryNames.has(entry));
  if (missingRequiredEntries.length > 0) {
    throw new Error(`Missing required runtime entries: ${missingRequiredEntries.join(",")}`);
  }

  compareRuntimeManifest(archive, entries);

  return {
    entries: entries.length,
    totalUncompressedBytes: entries.reduce(
      (total, entry) => total + entry.uncompressedSize,
      0
    )
  };
}

async function main() {
  const zipPath = process.argv[2] ?? RUNTIME_PACKAGE_PATH;
  try {
    const result = await auditRuntimeZipFile(zipPath);
    console.log(
      `Runtime package audit passed: ${result.entries} entries, ${result.totalUncompressedBytes} bytes`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
