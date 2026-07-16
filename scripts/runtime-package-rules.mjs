import { createHash } from "node:crypto";
import { isAbsolute, posix } from "node:path";
import { normalizePackageEntryName } from "./package-rules.mjs";

export const RUNTIME_PACKAGE_NAME = "AleksiWorkbench-Preview-win-x64";
export const RUNTIME_ARCHIVE_ROOT = "AleksiWorkbench-Preview";
export const RUNTIME_PACKAGE_DIR = `artifacts/${RUNTIME_ARCHIVE_ROOT}`;
export const RUNTIME_PACKAGE_PATH = `artifacts/${RUNTIME_PACKAGE_NAME}.zip`;
export const RUNTIME_BUILD_DIR = "artifacts/runtime-build";
export const RUNTIME_MANIFEST_NAME = "app/runtime-manifest.json";
export const RUNTIME_IDENTITY_VALUE_PATTERN = /^[a-z0-9.-]+$/u;

export const RUNTIME_REQUIRED_RELATIVE_ENTRIES = [
  "Start Aleksi Workbench.cmd",
  "Start Aleksi Workbench.ps1",
  "Stop Aleksi Workbench.cmd",
  "Stop Aleksi Workbench.ps1",
  "README_START.txt",
  "runtime/node.exe",
  "app/server.js",
  "app/runtime-manifest.json",
  "app/dist/index.html",
  "logs/.gitkeep",
  "data/.gitkeep"
];

export const RUNTIME_REQUIRED_ENTRIES = RUNTIME_REQUIRED_RELATIVE_ENTRIES.map(
  (entry) => `${RUNTIME_ARCHIVE_ROOT}/${entry}`
);

export const RUNTIME_FORBIDDEN_DIRECTORY_PREFIXES = [
  ".git/",
  ".smoke-manual/",
  ".vite/",
  ".worktrees/",
  "coverage/",
  "node_modules/",
  "playwright-report/",
  "app/dist/fonts/claude/",
  "public/fonts/claude/",
  "server/",
  "shared/",
  "src/",
  "test-results/",
  "tests/"
];

export const RUNTIME_FORBIDDEN_TEXT_SUBSTRINGS = [
  "/fonts/claude/",
  "fonts/claude/",
  "c66fc489e-C-BHYa_K.ttf",
  "cc27851ad-CFxw3nG7.ttf",
  "c5dbe0935-B88FVziN.ttf",
  "NotoSerifSC-VariableFont_wght.ttf",
  "NotoSansSC-VariableFont_wght.ttf",
  "SourceHanSansSC-Regular.otf",
  "SourceHanSansSC-Bold.otf"
];

export const RUNTIME_FORBIDDEN_EXACT_ENTRIES = [
  ".git",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "SOURCE_PACKAGE_MANIFEST.json",
  "tsconfig.app.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.test.json",
  "vite.config.ts",
  "vitest.config.ts"
];

export const RUNTIME_FORBIDDEN_FILE_NAMES = [
  ".DS_Store",
  "Thumbs.db"
];

export const RUNTIME_FORBIDDEN_FILE_SUFFIXES = [
  ".ts",
  ".tsx",
  ".tsbuildinfo"
];

const RUNTIME_FONT_FILE_SUFFIXES = [".otf", ".ttf", ".woff", ".woff2"];
const KATEX_FONT_ENTRY =
  /^app\/dist\/assets\/KaTeX_(?:AMS|Caligraphic|Fraktur|Main|Math|SansSerif|Script|Size[1-4]|Typewriter)[^/]*\.(?:ttf|woff2?)$/iu;

export function normalizeRuntimeEntryName(name) {
  return normalizePackageEntryName(name);
}

export function runtimeArchiveEntryName(relativeName) {
  return `${RUNTIME_ARCHIVE_ROOT}/${normalizeRuntimeEntryName(relativeName)}`;
}

export function isRuntimeContentBuildInput(relativeName) {
  const normalized = normalizeRuntimeEntryName(relativeName);
  return normalized === "app/server.js" || normalized.startsWith("app/dist/");
}

export function createRuntimeContentBuildId(entries) {
  const inputs = [...entries]
    .map((entry) => ({
      path: normalizeRuntimeEntryName(entry.path),
      data: Buffer.isBuffer(entry.data)
        ? entry.data
        : Buffer.from(entry.data)
    }))
    .filter((entry) => isRuntimeContentBuildInput(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path));

  if (
    !inputs.some((entry) => entry.path === "app/server.js") ||
    !inputs.some((entry) => entry.path === "app/dist/index.html")
  ) {
    throw new Error(
      "Runtime build identity requires app/server.js and app/dist/index.html"
    );
  }

  const hash = createHash("sha256");
  for (const entry of inputs) {
    hash.update(`${entry.path}\0${entry.data.byteLength}\0`, "utf8");
    hash.update(entry.data);
    hash.update("\0", "utf8");
  }

  return `sha256-${hash.digest("hex").slice(0, 20)}`;
}

export function stripRuntimeArchiveRoot(name) {
  const normalized = normalizeRuntimeEntryName(name);
  const prefix = `${RUNTIME_ARCHIVE_ROOT}/`;

  if (normalized === RUNTIME_ARCHIVE_ROOT) {
    return "";
  }
  if (!normalized.startsWith(prefix)) {
    return null;
  }

  return normalized.slice(prefix.length);
}

export function findForbiddenRuntimeEntry(name) {
  const normalized = normalizeRuntimeEntryName(name);
  if (normalized.length === 0) {
    return "empty entry";
  }

  if (name.includes("\\")) {
    return "backslash path separator";
  }

  if (isAbsolute(name) || normalized.startsWith("/")) {
    return "absolute path";
  }

  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return "parent directory traversal";
  }

  if (posix.normalize(normalized) !== normalized) {
    return "non-normalized path";
  }

  const relativeName = stripRuntimeArchiveRoot(normalized);
  if (relativeName === null) {
    return "outside AleksiWorkbench-Preview/";
  }
  if (relativeName.length === 0) {
    return null;
  }

  const comparableRelativeName = relativeName.toLowerCase();
  const exactMatch = RUNTIME_FORBIDDEN_EXACT_ENTRIES.find(
    (entry) => entry.toLowerCase() === comparableRelativeName
  );
  if (exactMatch !== undefined) {
    return exactMatch;
  }

  const directoryName = comparableRelativeName.endsWith("/")
    ? comparableRelativeName
    : `${comparableRelativeName}/`;
  for (const prefix of RUNTIME_FORBIDDEN_DIRECTORY_PREFIXES) {
    const comparablePrefix = prefix.toLowerCase();
    if (
      directoryName === comparablePrefix ||
      comparableRelativeName.startsWith(comparablePrefix)
    ) {
      return prefix;
    }
  }

  const parts = relativeName.split("/");
  for (const part of parts) {
    const fileNameMatch = RUNTIME_FORBIDDEN_FILE_NAMES.find(
      (fileName) => fileName.toLowerCase() === part.toLowerCase()
    );
    if (fileNameMatch !== undefined) {
      return fileNameMatch;
    }
  }

  if (
    RUNTIME_FONT_FILE_SUFFIXES.some((suffix) =>
      comparableRelativeName.endsWith(suffix)
    ) &&
    !KATEX_FONT_ENTRY.test(relativeName)
  ) {
    return "non-KaTeX font binary";
  }

  for (const suffix of RUNTIME_FORBIDDEN_FILE_SUFFIXES) {
    if (comparableRelativeName.endsWith(suffix.toLowerCase())) {
      return suffix;
    }
  }

  return null;
}
