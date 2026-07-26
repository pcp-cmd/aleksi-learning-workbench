#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOP_LEVEL_KEYS = [
  "company",
  "description",
  "displayName",
  "executableName",
  "identifier",
  "installerFilename",
  "localProtocolVersion",
  "nodeRuntime",
  "projectSchemaVersion",
  "publisher",
  "releaseDirectory",
  "releaseSlug",
  "schemaVersion",
  "shortName",
  "signing",
  "upgradeFrom",
  "upgradeFromVersion",
  "version",
  "webView2",
  "windowsPathContracts"
];
const SIGNING_KEYS = [
  "legalPublisherStatus",
  "metadataOnly",
  "note",
  "status"
];
const WINDOWS_PATH_KEYS = [
  "backup",
  "cache",
  "config",
  "data",
  "defaultLibrary",
  "fallbackLibrary",
  "install",
  "log"
];
const WEBVIEW2_KEYS = [
  "installMode",
  "networkRequiredWhenMissing",
  "policy"
];
const NODE_RUNTIME_KEYS = [
  "architecture",
  "licensePath",
  "licenseSha256",
  "officialDownloadUrl",
  "officialLicenseUrl",
  "platform",
  "sha256",
  "version"
];
const UPGRADE_FROM_KEYS = [
  "installedExecutableBytes",
  "installedExecutableSha256",
  "installerBytes",
  "installerFilename",
  "installerSha256",
  "version"
];
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const REVERSE_DNS_IDENTIFIER = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkExactKeys(value, expectedKeys, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }

  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      errors.push(`${label} has unknown field "${key}"`);
    }
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${label} is missing required field "${key}"`);
    }
  }
  return true;
}

function checkNonBlankString(value, label, errors) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim()
  ) {
    errors.push(`${label} must be a non-blank string without surrounding whitespace`);
    return false;
  }
  if (/\p{Cc}/u.test(value)) {
    errors.push(`${label} must not contain control characters`);
    return false;
  }
  return true;
}

function checkPositiveInteger(value, label, errors) {
  if (!Number.isSafeInteger(value) || value < 1) {
    errors.push(`${label} must be a positive integer`);
    return false;
  }
  return true;
}

function formatValidationFailure(errors) {
  return `Invalid canonical release identity:\n${errors
    .map((error) => `- ${error}`)
    .join("\n")}`;
}

export function validateReleaseIdentityDocument(input) {
  const errors = [];
  if (!checkExactKeys(input, TOP_LEVEL_KEYS, "release identity", errors)) {
    throw new Error(formatValidationFailure(errors));
  }

  for (const field of [
    "company",
    "description",
    "displayName",
    "executableName",
    "identifier",
    "installerFilename",
    "publisher",
    "releaseDirectory",
    "releaseSlug",
    "shortName",
    "upgradeFromVersion",
    "version"
  ]) {
    checkNonBlankString(input[field], field, errors);
  }

  if (input.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }
  checkPositiveInteger(input.projectSchemaVersion, "projectSchemaVersion", errors);
  checkPositiveInteger(input.localProtocolVersion, "localProtocolVersion", errors);

  if (typeof input.version === "string" && !SEMVER.test(input.version)) {
    errors.push("version must be a valid semantic version");
  }
  if (
    typeof input.upgradeFromVersion === "string" &&
    !SEMVER.test(input.upgradeFromVersion)
  ) {
    errors.push("upgradeFromVersion must be a valid semantic version");
  }
  if (input.upgradeFromVersion === input.version) {
    errors.push("upgradeFromVersion must differ from version");
  }
  if (
    checkExactKeys(
      input.upgradeFrom,
      UPGRADE_FROM_KEYS,
      "upgradeFrom",
      errors
    )
  ) {
    checkNonBlankString(
      input.upgradeFrom.version,
      "upgradeFrom.version",
      errors
    );
    checkNonBlankString(
      input.upgradeFrom.installerFilename,
      "upgradeFrom.installerFilename",
      errors
    );
    checkPositiveInteger(
      input.upgradeFrom.installerBytes,
      "upgradeFrom.installerBytes",
      errors
    );
    checkPositiveInteger(
      input.upgradeFrom.installedExecutableBytes,
      "upgradeFrom.installedExecutableBytes",
      errors
    );
    for (const field of ["installerSha256", "installedExecutableSha256"]) {
      if (!/^[a-f0-9]{64}$/u.test(input.upgradeFrom[field] ?? "")) {
        errors.push(`upgradeFrom.${field} must be a lowercase SHA-256`);
      }
    }
    if (!SEMVER.test(input.upgradeFrom.version ?? "")) {
      errors.push("upgradeFrom.version must be a valid semantic version");
    }
    if (input.upgradeFrom.version !== input.upgradeFromVersion) {
      errors.push("upgradeFrom.version must match upgradeFromVersion");
    }
    if (input.upgradeFrom.version === input.version) {
      errors.push("upgradeFrom.version must differ from version");
    }
    if (!/\.exe$/iu.test(input.upgradeFrom.installerFilename ?? "")) {
      errors.push("upgradeFrom.installerFilename must be an .exe filename");
    }
  }
  if (
    typeof input.identifier === "string" &&
    !REVERSE_DNS_IDENTIFIER.test(input.identifier)
  ) {
    errors.push("identifier must be a lowercase reverse-DNS identifier");
  }
  if (input.publisher !== input.company) {
    errors.push("publisher and company must match until legal publisher metadata is confirmed");
  }

  if (
    typeof input.releaseSlug === "string" &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.releaseSlug)
  ) {
    errors.push("releaseSlug must be lowercase kebab-case");
  }
  if (
    typeof input.executableName === "string" &&
    typeof input.releaseSlug === "string" &&
    input.executableName !== `${input.releaseSlug}.exe`
  ) {
    errors.push(`executableName must be ${input.releaseSlug}.exe`);
  }
  if (
    typeof input.installerFilename === "string" &&
    typeof input.displayName === "string" &&
    typeof input.version === "string"
  ) {
    const expectedInstaller = `${input.displayName.replaceAll(" ", "-")}-${input.version}-Setup.exe`;
    if (input.installerFilename !== expectedInstaller) {
      errors.push(`installerFilename must be ${expectedInstaller}`);
    }
  }
  if (
    typeof input.releaseDirectory === "string" &&
    typeof input.releaseSlug === "string" &&
    typeof input.version === "string"
  ) {
    const expectedDirectory = `artifacts/release/${input.releaseSlug}/${input.version}`;
    if (input.releaseDirectory !== expectedDirectory) {
      errors.push(`releaseDirectory must be ${expectedDirectory}`);
    }
  }

  if (checkExactKeys(input.signing, SIGNING_KEYS, "signing", errors)) {
    checkNonBlankString(input.signing.note, "signing.note", errors);
    if (input.signing.status !== "unsigned-preview") {
      errors.push('signing.status must be "unsigned-preview"');
    }
    if (input.signing.metadataOnly !== true) {
      errors.push("signing.metadataOnly must be true for this unsigned preview");
    }
    if (input.signing.legalPublisherStatus !== "pending-user-confirmation") {
      errors.push(
        'signing.legalPublisherStatus must be "pending-user-confirmation"'
      );
    }
  }

  if (
    checkExactKeys(
      input.windowsPathContracts,
      WINDOWS_PATH_KEYS,
      "windowsPathContracts",
      errors
    )
  ) {
    for (const key of WINDOWS_PATH_KEYS) {
      checkNonBlankString(
        input.windowsPathContracts[key],
        `windowsPathContracts.${key}`,
        errors
      );
    }
    const paths = input.windowsPathContracts;
    if (
      typeof paths.data === "string" &&
      typeof paths.config === "string" &&
      !paths.config.startsWith(`${paths.data}\\`)
    ) {
      errors.push("windowsPathContracts.config must be located below data");
    }
    if (
      typeof paths.data === "string" &&
      typeof paths.log === "string" &&
      !paths.log.startsWith(`${paths.data}\\`)
    ) {
      errors.push("windowsPathContracts.log must be located below data");
    }
    if (
      typeof paths.data === "string" &&
      typeof paths.fallbackLibrary === "string" &&
      !paths.fallbackLibrary.startsWith(`${paths.data}\\`)
    ) {
      errors.push("windowsPathContracts.fallbackLibrary must be located below data");
    }
    if (
      typeof paths.install === "string" &&
      !paths.install.startsWith("%LOCALAPPDATA%\\")
    ) {
      errors.push("windowsPathContracts.install must use the current-user LOCALAPPDATA root");
    }
    if (
      typeof paths.defaultLibrary === "string" &&
      !paths.defaultLibrary.startsWith("%USERPROFILE%\\Documents\\")
    ) {
      errors.push("windowsPathContracts.defaultLibrary must use the user's Documents directory");
    }
    if (
      typeof paths.cache === "string" &&
      !paths.cache.startsWith("<LOCAL_LEARNING_LIBRARY>\\")
    ) {
      errors.push("windowsPathContracts.cache must be relative to the active learning library");
    }
    if (
      typeof paths.backup === "string" &&
      !paths.backup.startsWith("<LOCAL_LEARNING_LIBRARY_PARENT>\\")
    ) {
      errors.push("windowsPathContracts.backup must be a sibling of the active learning library");
    }
  }

  if (checkExactKeys(input.webView2, WEBVIEW2_KEYS, "webView2", errors)) {
    if (input.webView2.policy !== "online-light") {
      errors.push('webView2.policy must be "online-light"');
    }
    if (input.webView2.installMode !== "downloadBootstrapper") {
      errors.push('webView2.installMode must be "downloadBootstrapper"');
    }
    if (input.webView2.networkRequiredWhenMissing !== true) {
      errors.push("webView2.networkRequiredWhenMissing must be true");
    }
  }

  if (
    checkExactKeys(
      input.nodeRuntime,
      NODE_RUNTIME_KEYS,
      "nodeRuntime",
      errors
    )
  ) {
    for (const key of NODE_RUNTIME_KEYS) {
      checkNonBlankString(input.nodeRuntime[key], `nodeRuntime.${key}`, errors);
    }
    if (!/^v\d+\.\d+\.\d+$/u.test(input.nodeRuntime.version ?? "")) {
      errors.push("nodeRuntime.version must be an exact v-prefixed semantic version");
    }
    if (input.nodeRuntime.platform !== "win32") {
      errors.push('nodeRuntime.platform must be "win32"');
    }
    if (input.nodeRuntime.architecture !== "x64") {
      errors.push('nodeRuntime.architecture must be "x64"');
    }
    for (const field of ["sha256", "licenseSha256"]) {
      if (!/^[a-f0-9]{64}$/u.test(input.nodeRuntime[field] ?? "")) {
        errors.push(`nodeRuntime.${field} must be a lowercase SHA-256`);
      }
    }
    if (
      input.nodeRuntime.officialDownloadUrl !==
      `https://nodejs.org/dist/${input.nodeRuntime.version}/win-x64/node.exe`
    ) {
      errors.push("nodeRuntime.officialDownloadUrl must match the pinned official Node binary");
    }
    if (
      input.nodeRuntime.officialLicenseUrl !==
      `https://github.com/nodejs/node/blob/${input.nodeRuntime.version}/LICENSE`
    ) {
      errors.push("nodeRuntime.officialLicenseUrl must match the pinned official Node tag");
    }
    if (
      input.nodeRuntime.licensePath !==
      `release/licenses/NODEJS-LICENSE-${input.nodeRuntime.version}.txt`
    ) {
      errors.push("nodeRuntime.licensePath must match the pinned Node version");
    }
  }

  if (errors.length > 0) {
    throw new Error(formatValidationFailure(errors));
  }
  return input;
}

function packageSection(source) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\[package\]\s*$/u.test(line));
  if (start === -1) return "";
  const nextSection = lines.findIndex(
    (line, index) => index > start && /^\[/u.test(line)
  );
  return lines.slice(start + 1, nextSection === -1 ? undefined : nextSection).join("\n");
}

function tomlStringValue(source, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `^\\s*${escapedField}\\s*=\\s*"([^"]+)"\\s*$`,
    "mu"
  ).exec(source);
  return match?.[1] ?? null;
}

export function cargoPackageVersion(cargoToml) {
  return tomlStringValue(packageSection(cargoToml), "version");
}

export function cargoLockPackageVersion(cargoLock, packageName) {
  for (const block of cargoLock.split(/^\[\[package\]\]\s*$/mu).slice(1)) {
    if (tomlStringValue(block, "name") === packageName) {
      return tomlStringValue(block, "version");
    }
  }
  return null;
}

function sourceConsumesCanonicalIdentity(source) {
  return /release[\\/]identity\.json/u.test(source);
}

function sourceUsesProperty(source, property) {
  return new RegExp(`\\.${property}\\b`, "u").test(source);
}

export function collectSourceAlignmentErrors(identityInput, sources, options = {}) {
  const identity = validateReleaseIdentityDocument(identityInput);
  const errors = [];
  const allowVersionMismatch = options.allowSourceVersionMismatch === true;
  const packageVersion = sources.packageJson?.version;
  const cargoVersion = cargoPackageVersion(sources.cargoToml);
  const cargoLockVersion = cargoLockPackageVersion(
    sources.cargoLock,
    "aleksi-workbench"
  );
  const tauriVersion = sources.tauriConfig?.version;

  if (!allowVersionMismatch) {
    for (const [label, actual] of [
      ["package.json version", packageVersion],
      ["src-tauri/Cargo.toml package version", cargoVersion],
      ["src-tauri/Cargo.lock aleksi-workbench version", cargoLockVersion],
      ["src-tauri/tauri.conf.json version", tauriVersion]
    ]) {
      if (actual !== identity.version) {
        errors.push(
          `${label} is ${actual ?? "missing"}; expected canonical version ${identity.version}`
        );
      }
    }
  }

  const tauri = sources.tauriConfig;
  if (tauri?.productName !== identity.displayName) {
    errors.push(
      `src-tauri/tauri.conf.json productName is ${tauri?.productName ?? "missing"}; expected ${identity.displayName}`
    );
  }
  if (tauri?.identifier !== identity.identifier) {
    errors.push(
      `src-tauri/tauri.conf.json identifier is ${tauri?.identifier ?? "missing"}; expected ${identity.identifier}`
    );
  }
  if (tauri?.bundle?.publisher !== identity.publisher) {
    errors.push(
      `src-tauri/tauri.conf.json bundle.publisher is ${tauri?.bundle?.publisher ?? "missing"}; expected ${identity.publisher}`
    );
  }
  if (tauri?.bundle?.longDescription !== identity.description) {
    errors.push("src-tauri/tauri.conf.json longDescription does not match canonical description");
  }
  const windowTitles = Array.isArray(tauri?.app?.windows)
    ? tauri.app.windows.map((window) => window?.title)
    : [];
  if (windowTitles.length === 0 || windowTitles.some((title) => title !== identity.displayName)) {
    errors.push("every Tauri window title must match the canonical displayName");
  }
  if (
    tauri?.bundle?.windows?.webviewInstallMode?.type !==
    identity.webView2.installMode
  ) {
    errors.push("Tauri WebView2 install mode does not match the canonical policy");
  }
  if (tauri?.bundle?.windows?.nsis?.installMode !== "currentUser") {
    errors.push("Tauri NSIS installMode must be currentUser for the canonical install path");
  }

  const prepare = sources.prepareDesktopSource;
  if (!sourceConsumesCanonicalIdentity(prepare)) {
    errors.push("scripts/prepare-desktop.mjs must consume release/identity.json");
  }
  for (const property of [
    "displayName",
    "localProtocolVersion",
    "nodeRuntime",
    "projectSchemaVersion",
    "version"
  ]) {
    if (!sourceUsesProperty(prepare, property)) {
      errors.push(`scripts/prepare-desktop.mjs must consume canonical ${property}`);
    }
  }
  if (/\bpackageJson\.version\b/u.test(prepare)) {
    errors.push("scripts/prepare-desktop.mjs must not derive runtime version from package.json");
  }

  const packageRules = sources.desktopPackageRulesSource;
  if (!sourceConsumesCanonicalIdentity(packageRules)) {
    errors.push(
      "scripts/desktop-package-rules.mjs must derive its installer path from release/identity.json"
    );
  }
  for (const property of ["installerFilename", "releaseDirectory"]) {
    if (!sourceUsesProperty(packageRules, property)) {
      errors.push(
        `scripts/desktop-package-rules.mjs must consume canonical ${property}`
      );
    }
  }

  return errors;
}

function parseArguments(argv) {
  const options = {
    allowSourceVersionMismatch: false,
    identityPath: "release/identity.json",
    root: process.cwd()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-source-version-mismatch") {
      options.allowSourceVersionMismatch = true;
    } else if (argument === "--root" || argument === "--identity") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a path`);
      }
      if (argument === "--root") options.root = value;
      else options.identityPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  options.root = resolve(options.root);
  options.identityPath = isAbsolute(options.identityPath)
    ? options.identityPath
    : resolve(options.root, options.identityPath);
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function verifyReleaseIdentityRepository(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const identityPath = isAbsolute(options.identityPath ?? "")
    ? options.identityPath
    : resolve(root, options.identityPath ?? "release/identity.json");
  const [identityInput, packageJson, cargoToml, cargoLock, tauriConfig, prepareDesktopSource, desktopPackageRulesSource] =
    await Promise.all([
      readJson(identityPath),
      readJson(resolve(root, "package.json")),
      readFile(resolve(root, "src-tauri/Cargo.toml"), "utf8"),
      readFile(resolve(root, "src-tauri/Cargo.lock"), "utf8"),
      readJson(resolve(root, "src-tauri/tauri.conf.json")),
      readFile(resolve(root, "scripts/prepare-desktop.mjs"), "utf8"),
      readFile(resolve(root, "scripts/desktop-package-rules.mjs"), "utf8")
    ]);
  const identity = validateReleaseIdentityDocument(identityInput);
  const errors = collectSourceAlignmentErrors(
    identity,
    {
      cargoLock,
      cargoToml,
      desktopPackageRulesSource,
      packageJson,
      prepareDesktopSource,
      tauriConfig
    },
    { allowSourceVersionMismatch: options.allowSourceVersionMismatch === true }
  );
  if (errors.length > 0) {
    throw new Error(
      `Canonical release identity mismatch:\n${errors
        .map((error) => `- ${error}`)
        .join("\n")}`
    );
  }
  return identity;
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const identity = await verifyReleaseIdentityRepository(options);
    console.log(
      `Canonical release identity verified: ${identity.displayName} ${identity.version}`
    );
    console.log(`Installer: ${identity.releaseDirectory}/${identity.installerFilename}`);
    console.log(`Signing status: ${identity.signing.status}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
