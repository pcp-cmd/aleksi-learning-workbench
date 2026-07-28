export const SOURCE_PACKAGE_PATH = "artifacts/aleksi-learning-workbench-source.zip";
export const SOURCE_MANIFEST_NAME = "SOURCE_PACKAGE_MANIFEST.json";
export const RUNTIME_MANIFEST_NAME = "RUNTIME_MANIFEST.json";

export const SOURCE_PACKAGE_MAX_ARCHIVE_BYTES = 12 * 1024 * 1024;
// The 0.1.4 recovery tests and implementation plan push the reviewed source
// tree slightly beyond the former 8 MiB ceiling. Keep a tight, explicit cap
// while allowing the complete auditable source set to travel together.
export const SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;
export const SOURCE_PACKAGE_MAX_ENTRY_BYTES = 3 * 1024 * 1024;

export const FORBIDDEN_DIRECTORY_PREFIXES = [
  ".git/",
  ".runtime-debug/",
  ".vite/",
  ".worktrees/",
  ".superpowers/",
  "artifacts/",
  "coverage/",
  "dist/",
  "node_modules/",
  "outputs/",
  "playwright-report/",
  "public/fonts/claude/",
  "src-tauri/resources/sidecar/",
  "src-tauri/target/",
  "test-results/"
];

export const FORBIDDEN_EXACT_ENTRIES = [
  ".git",
  "DESKTOP_PACKAGE_MANIFEST.json",
  "src-tauri/resources/identity.json",
  RUNTIME_MANIFEST_NAME
];

export const FORBIDDEN_FILE_NAMES = [
  ".DS_Store",
  "Thumbs.db"
];

export const FORBIDDEN_FILE_SUFFIXES = [
  ".tsbuildinfo"
];

export const FORBIDDEN_LOCAL_ENV_PATTERN =
  ".env and .env.* except .env.example";

export const FORBIDDEN_ENTRY_SUBSTRINGS = [
  "AleksiWorkbench-Preview/",
  "runtime/node.exe",
  "logs/latest.log",
  "runtime.pid"
];

export function normalizePackageEntryName(name) {
  return String(name)
    .replaceAll("\\", "/")
    .replace(/^\/+/u, "")
    .replace(/^\.\//u, "");
}

export function findForbiddenPackageEntry(name) {
  const normalized = normalizePackageEntryName(name);
  const comparable = normalized.toLowerCase();
  if (normalized.length === 0) {
    return "empty entry";
  }

  const exactMatch = FORBIDDEN_EXACT_ENTRIES.find(
    (entry) => entry.toLowerCase() === comparable
  );
  if (exactMatch !== undefined) {
    return exactMatch;
  }

  const directoryName = comparable.endsWith("/")
    ? comparable
    : `${comparable}/`;
  for (const prefix of FORBIDDEN_DIRECTORY_PREFIXES) {
    const comparablePrefix = prefix.toLowerCase();
    const cleanPrefix = comparablePrefix.replace(/\/$/u, "");
    if (
      directoryName === comparablePrefix ||
      comparable.startsWith(comparablePrefix) ||
      comparable === cleanPrefix ||
      comparable.includes(`/${comparablePrefix}`)
    ) {
      return prefix;
    }
  }

  for (const fragment of FORBIDDEN_ENTRY_SUBSTRINGS) {
    if (comparable.includes(fragment.toLowerCase())) {
      return fragment;
    }
  }

  const parts = normalized.split("/");
  for (const part of parts) {
    const comparablePart = part.toLowerCase();
    if (
      comparablePart === ".env" ||
      (comparablePart.startsWith(".env.") &&
        comparablePart !== ".env.example")
    ) {
      return FORBIDDEN_LOCAL_ENV_PATTERN;
    }

    const fileNameMatch = FORBIDDEN_FILE_NAMES.find(
      (fileName) => fileName.toLowerCase() === comparablePart
    );
    if (fileNameMatch !== undefined) {
      return fileNameMatch;
    }
  }

  for (const suffix of FORBIDDEN_FILE_SUFFIXES) {
    if (comparable.endsWith(suffix.toLowerCase())) {
      return suffix;
    }
  }

  return null;
}

export function shouldIncludeSourceEntry(relativePath) {
  const normalized = normalizePackageEntryName(relativePath);
  return (
    normalized !== SOURCE_MANIFEST_NAME &&
    normalized !== RUNTIME_MANIFEST_NAME &&
    findForbiddenPackageEntry(normalized) === null
  );
}
