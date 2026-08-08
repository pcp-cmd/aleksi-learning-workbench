#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLicenseInventory,
  createLicenseReadme,
  createThirdPartyNotices,
  parseCargoLockPackages
} from "./generate-license-report.mjs";
import { createSpdxDocument } from "./generate-sbom.mjs";
import {
  validateReleaseIdentityDocument,
  verifyReleaseIdentityRepository
} from "./verify-release-identity.mjs";
import {
  createInstalledEvidenceBundle,
  INSTALLED_EVIDENCE_FILENAME
} from "./write-installed-test-reports.mjs";

const DEFAULT_MINIMUM_INSTALLER_BYTES = 5 * 1024 * 1024;
const MANIFEST_FILENAME = "release-manifest.json";
const SMOKE_REPORT_FILENAME = "smoke-test-report.md";
const UPGRADE_REPORT_FILENAME = "upgrade-test-report.md";
const UNINSTALL_EVIDENCE_FILENAME = "uninstall-reinstall-evidence.json";
const UNINSTALL_REPORT_FILENAME = "uninstall-test-report.md";
const LIFECYCLE_TOP_LEVEL_KEYS = [
  "backup",
  "evidenceBoundary",
  "identity",
  "installation",
  "installedEvidence",
  "installer",
  "recovery",
  "reinstall",
  "result",
  "runtime",
  "schemaVersion",
  "testedAtUtc",
  "uninstall",
  "userDataFingerprintsAfterReinstall",
  "userDataFingerprintsAfterUninstall",
  "userDataFingerprintsBefore"
];
const LIFECYCLE_INSTALLER_KEYS = ["bytes", "path", "sha256"];
const LIFECYCLE_INSTALLED_EVIDENCE_KEYS = [
  "bytes",
  "path",
  "sha256",
  "testedAtUtc"
];
const LIFECYCLE_IDENTITY_KEYS = [
  "nodeSha256",
  "nodeVersion",
  "protocolVersion",
  "runtimeIdentityBytes",
  "runtimeIdentitySha256",
  "shellBuildId",
  "sidecarBuildId",
  "version"
];
const LIFECYCLE_INSTALLATION_KEYS = [
  "executableBytesAfter",
  "executableBytesBefore",
  "executablePath",
  "executableSha256After",
  "executableSha256Before",
  "installRoot"
];
const LIFECYCLE_BACKUP_KEYS = [
  "backupFingerprintDigest",
  "bytes",
  "fileCount",
  "manifestBytes",
  "manifestPath",
  "manifestSha256",
  "root",
  "sourceFingerprintDigest"
];
const LIFECYCLE_UNINSTALL_KEYS = [
  "exitCode",
  "installDirectoryRemoved",
  "registryKeyRemoved"
];
const LIFECYCLE_REINSTALL_KEYS = ["exitCode", "registryVersion"];
const LIFECYCLE_RUNTIME_KEYS = [
  "dynamicPort",
  "normalWindowCloseStopsSidecar",
  "oneSidecarProcess"
];
const LIFECYCLE_RECOVERY_KEYS = [
  "applicationRestored",
  "attempted",
  "installerExitCode"
];
const BACKUP_MANIFEST_KEYS = [
  "createdAtUtc",
  "inventorySemantics",
  "roots",
  "schemaVersion",
  "summary"
];
const BACKUP_MANIFEST_ROOT_KEYS = [
  "directory",
  "exists",
  "files",
  "label"
];
const BACKUP_MANIFEST_FILE_KEYS = ["bytes", "path", "sha256"];
const BACKUP_MANIFEST_SUMMARY_KEYS = [
  "backupFingerprintDigest",
  "bytes",
  "fileCount",
  "sourceFingerprintDigest"
];
const LIFECYCLE_FINGERPRINT_KEYS = [
  "bytes",
  "digest",
  "exists",
  "fileCount",
  "label"
];
const REQUIRED_LIFECYCLE_FINGERPRINT_LABELS = [
  "%APPDATA%\\Aleksi Learning Workbench",
  "%APPDATA%\\io.aleksi.workbench",
  "%LOCALAPPDATA%\\io.aleksi.workbench",
  "%USERPROFILE%\\Documents\\Aleksi Learning Workbench"
];
const OPTIONAL_LIFECYCLE_FINGERPRINT_LABEL =
  "<ACTIVE_LEARNING_LIBRARY>";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ISO_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/u;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

async function writeJson(path, value) {
  await writeFile(path, stableJson(value), "utf8");
}

function normalizeRelativePath(path) {
  return path.replaceAll("\\", "/");
}

function commandBuffer(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function commandOutput(command, args, cwd) {
  return commandBuffer(command, args, cwd).toString("utf8").trimEnd();
}

export function inspectPeMachine(data) {
  if (data.length < 0x40 || data[0] !== 0x4d || data[1] !== 0x5a) {
    throw new Error("Windows executable is missing the MZ header");
  }
  const peOffset = data.readUInt32LE(0x3c);
  if (peOffset < 0x40 || peOffset + 6 > data.length) {
    throw new Error("Windows executable has an invalid PE header offset");
  }
  if (data.readUInt32LE(peOffset) !== 0x0000_4550) {
    throw new Error("Windows executable is missing the PE signature");
  }
  const machine = data.readUInt16LE(peOffset + 4);
  if (machine === 0x014c) {
    return "I386";
  }
  if (machine === 0x8664) {
    return "AMD64";
  }
  throw new Error(
    `Windows executable machine 0x${machine.toString(16)} is unsupported`
  );
}

export function inspectPeAuthenticodeStatus(data) {
  if (data.length < 0x40 || data[0] !== 0x4d || data[1] !== 0x5a) {
    throw new Error("Windows executable is missing the MZ header");
  }
  const peOffset = data.readUInt32LE(0x3c);
  const optionalHeaderOffset = peOffset + 24;
  if (peOffset < 0x40 || optionalHeaderOffset + 2 > data.length) {
    throw new Error("Windows executable has an invalid optional-header offset");
  }
  const optionalHeaderSize = data.readUInt16LE(peOffset + 20);
  const optionalHeaderEnd = optionalHeaderOffset + optionalHeaderSize;
  if (optionalHeaderEnd > data.length) {
    throw new Error("Windows executable has a truncated optional header");
  }
  const magic = data.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset =
    magic === 0x010b
      ? optionalHeaderOffset + 96
      : magic === 0x020b
        ? optionalHeaderOffset + 112
        : null;
  const directoryCountOffset =
    magic === 0x010b
      ? optionalHeaderOffset + 92
      : magic === 0x020b
        ? optionalHeaderOffset + 108
        : null;
  if (dataDirectoryOffset === null || directoryCountOffset === null) {
    throw new Error(
      `Windows executable optional-header magic 0x${magic.toString(16)} is unsupported`
    );
  }
  if (directoryCountOffset + 4 > optionalHeaderEnd) {
    throw new Error("Windows executable is missing its data-directory count");
  }
  const directoryCount = data.readUInt32LE(directoryCountOffset);
  if (directoryCount <= 4) {
    return "NotSigned";
  }
  const certificateDirectoryOffset = dataDirectoryOffset + 4 * 8;
  if (certificateDirectoryOffset + 8 > optionalHeaderEnd) {
    throw new Error("Windows executable is missing its certificate directory");
  }
  const certificateOffset = data.readUInt32LE(certificateDirectoryOffset);
  const certificateSize = data.readUInt32LE(certificateDirectoryOffset + 4);
  if (certificateOffset === 0 && certificateSize === 0) {
    return "NotSigned";
  }
  if (
    certificateOffset === 0 ||
    certificateSize === 0 ||
    certificateOffset + certificateSize > data.length
  ) {
    throw new Error("Windows executable has an invalid certificate table");
  }
  return "Present";
}

function inspectWindowsVersionAndSignature(path, root) {
  const pathLiteral = `'${path.replaceAll("'", "''")}'`;
  const source = [
    `$item = Get-Item -LiteralPath ${pathLiteral}`,
    "$version = $item.VersionInfo",
    "$signature = Get-AuthenticodeSignature -FilePath $item.FullName",
    "[ordered]@{ authenticodeStatus = [string]$signature.Status; productName = [string]$version.ProductName; fileDescription = [string]$version.FileDescription; productVersion = [string]$version.ProductVersion; fileVersion = [string]$version.FileVersion } | ConvertTo-Json -Compress"
  ].join("; ");
  const output = commandOutput(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", source],
    root
  );
  return JSON.parse(output);
}

export function inspectInstallerMetadata(path, data, root) {
  const windowsMetadata = inspectWindowsVersionAndSignature(path, root);
  const peAuthenticodeStatus = inspectPeAuthenticodeStatus(data);
  const powershellStatus = String(
    windowsMetadata.authenticodeStatus ?? ""
  ).trim();
  if (
    powershellStatus === "NotSigned" &&
    peAuthenticodeStatus !== "NotSigned"
  ) {
    throw new Error(
      "PowerShell reported NotSigned but the PE certificate table is present"
    );
  }
  return {
    peMachine: inspectPeMachine(data),
    ...windowsMetadata,
    authenticodeStatus:
      powershellStatus.length === 0
        ? peAuthenticodeStatus
        : powershellStatus,
    authenticodeInspection:
      powershellStatus.length === 0
        ? "pe-certificate-table-fallback"
        : "powershell-and-pe-certificate-table"
  };
}

function detectSourceState(root) {
  const commit = commandOutput("git", ["rev-parse", "HEAD"], root);
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("Git did not return a full 40-character commit SHA");
  }
  const status = commandOutput(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    root
  );
  const dirtyFiles = status.length === 0
    ? []
    : status
        .split(/\r?\n/u)
        .map((line) => normalizeRelativePath(line.slice(3)))
        .sort();
  const fingerprint = createHash("sha256");
  fingerprint.update("tracked-diff\0");
  fingerprint.update(commandBuffer("git", ["diff", "--binary", "HEAD"], root));
  const untracked = commandBuffer(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    root
  )
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0)
    .sort();
  for (const path of untracked) {
    const absolutePath = resolve(root, path);
    assertInsideRoot(root, absolutePath, "Untracked provenance input");
    const information = lstatSync(absolutePath);
    fingerprint.update("untracked\0");
    fingerprint.update(normalizeRelativePath(path));
    fingerprint.update("\0");
    if (information.isSymbolicLink()) {
      fingerprint.update("symlink\0");
      fingerprint.update(readlinkSync(absolutePath));
    } else if (information.isFile()) {
      fingerprint.update("file\0");
      fingerprint.update(readFileSync(absolutePath));
    } else {
      fingerprint.update(`other:${information.mode}\0`);
    }
  }
  return {
    commit,
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
    worktreeFingerprint: fingerprint.digest("hex"),
    worktreeFingerprintScope: "git-diff-binary-plus-untracked-content"
  };
}

function validIsoDate(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return date.toISOString();
}

function resolveBuildDate(options, root) {
  if (options.buildDate !== undefined) {
    return { value: validIsoDate(options.buildDate, "buildDate"), source: "explicit" };
  }
  if (process.env.SOURCE_DATE_EPOCH !== undefined) {
    if (!/^\d+$/u.test(process.env.SOURCE_DATE_EPOCH)) {
      throw new Error("SOURCE_DATE_EPOCH must be an integer number of seconds");
    }
    return {
      value: new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString(),
      source: "SOURCE_DATE_EPOCH"
    };
  }
  if (process.env.ALEKSI_BUILD_DATE !== undefined) {
    return {
      value: validIsoDate(process.env.ALEKSI_BUILD_DATE, "ALEKSI_BUILD_DATE"),
      source: "ALEKSI_BUILD_DATE"
    };
  }
  return {
    value: validIsoDate(
      commandOutput("git", ["show", "-s", "--format=%cI", "HEAD"], root),
      "Git commit date"
    ),
    source: "git-commit-date"
  };
}

function detectToolVersions() {
  const npmAgent = process.env.npm_config_user_agent?.match(/\bnpm\/([^\s]+)/u)?.[1];
  let rustc = "unavailable";
  try {
    rustc = commandOutput("rustc", ["--version"], process.cwd());
  } catch {
    // The provenance records an unavailable Rust tool instead of inventing one.
  }
  return {
    node: process.version,
    npm: npmAgent ?? "unavailable",
    rustc
  };
}

function targetTriple(platform, architecture) {
  if (process.env.CARGO_BUILD_TARGET) return process.env.CARGO_BUILD_TARGET;
  if (platform === "win32" && architecture === "x64") {
    return "x86_64-pc-windows-msvc";
  }
  if (platform === "win32" && architecture === "arm64") {
    return "aarch64-pc-windows-msvc";
  }
  return `${architecture}-${platform}`;
}

function assertInsideRoot(root, target, label) {
  const fromRoot = relative(root, target);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`${label} leaves the repository root`);
  }
}

function isMissingPathError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function assertNoLinkAncestors(root, target, label) {
  assertInsideRoot(root, target, label);
  const realRoot = await realpath(root);
  const segments = relative(root, target)
    .split(sep)
    .filter((segment) => segment.length > 0);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    let information;
    try {
      information = await lstat(current);
    } catch (error) {
      if (isMissingPathError(error)) {
        return realRoot;
      }
      throw error;
    }
    if (information.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic-link or junction ancestor`);
    }
    if (index < segments.length - 1 && !information.isDirectory()) {
      throw new Error(`${label} contains a non-directory ancestor`);
    }
    const realCurrent = await realpath(current);
    assertInsideRoot(realRoot, realCurrent, `${label} real path`);
  }
  return realRoot;
}

async function assertNoLinksInTree(directory, realRoot, label) {
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    const information = await lstat(current);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new Error(`${label} must contain only non-link directories`);
    }
    assertInsideRoot(
      realRoot,
      await realpath(current),
      `${label} directory real path`
    );
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolutePath = resolve(current, entry.name);
      const entryInformation = await lstat(absolutePath);
      if (entryInformation.isSymbolicLink()) {
        throw new Error(`${label} contains a symbolic link or junction`);
      }
      assertInsideRoot(
        realRoot,
        await realpath(absolutePath),
        `${label} entry real path`
      );
      if (entryInformation.isDirectory()) {
        pending.push(absolutePath);
      } else if (!entryInformation.isFile()) {
        throw new Error(`${label} contains a non-regular entry`);
      }
    }
  }
}

async function optionalFile(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseJsonBuffer(data) {
  return JSON.parse(data.toString("utf8").replace(/^\uFEFF/u, ""));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      `${label} fields mismatch: expected ${expected.join(", ")}, got ${actual.join(", ")}`
    );
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function requireString(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`${label} must be a non-blank trimmed string`);
  }
  return value;
}

function requireHash(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
  return value;
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `${label} must be an integer greater than or equal to ${minimum}`
    );
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function requirePortableRelativePath(value, label) {
  const path = requireString(value, label);
  if (
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    /^[/\\]{2}/u.test(path) ||
    path.includes("\0") ||
    path.includes("\\") ||
    path
      .split("/")
      .some(
        (segment) =>
          segment === "." || segment === ".." || segment.length === 0
      )
  ) {
    throw new Error(`${label} must be a portable repository-relative path`);
  }
  return path;
}

function canonicalLifecycleFingerprint(input, label) {
  assertExactKeys(input, LIFECYCLE_FINGERPRINT_KEYS, label);
  const fingerprint = {
    label: requireString(input.label, `${label}.label`),
    exists: requireBoolean(input.exists, `${label}.exists`),
    fileCount: requireInteger(input.fileCount, `${label}.fileCount`),
    bytes: requireInteger(input.bytes, `${label}.bytes`),
    digest: requireHash(input.digest, `${label}.digest`)
  };
  if (
    !fingerprint.exists &&
    (fingerprint.fileCount !== 0 || fingerprint.bytes !== 0)
  ) {
    throw new Error(`${label} cannot report files or bytes for a missing root`);
  }
  return fingerprint;
}

function canonicalLifecycleFingerprints(input, label) {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array`);
  }
  const byLabel = new Map();
  for (const [index, value] of input.entries()) {
    const fingerprint = canonicalLifecycleFingerprint(
      value,
      `${label}[${index}]`
    );
    if (byLabel.has(fingerprint.label)) {
      throw new Error(`${label} contains duplicate label ${fingerprint.label}`);
    }
    if (
      !REQUIRED_LIFECYCLE_FINGERPRINT_LABELS.includes(fingerprint.label) &&
      fingerprint.label !== OPTIONAL_LIFECYCLE_FINGERPRINT_LABEL
    ) {
      throw new Error(`${label} contains unsupported label ${fingerprint.label}`);
    }
    byLabel.set(fingerprint.label, fingerprint);
  }
  for (const required of REQUIRED_LIFECYCLE_FINGERPRINT_LABELS) {
    if (!byLabel.has(required)) {
      throw new Error(`${label} is missing required root ${required}`);
    }
  }
  return [
    ...REQUIRED_LIFECYCLE_FINGERPRINT_LABELS,
    ...(byLabel.has(OPTIONAL_LIFECYCLE_FINGERPRINT_LABEL)
      ? [OPTIONAL_LIFECYCLE_FINGERPRINT_LABEL]
      : [])
  ].map((fingerprintLabel) => byLabel.get(fingerprintLabel));
}

function lifecycleFingerprintDigest(fingerprints) {
  const encoded = fingerprints
    .map((entry) =>
      [
        entry.label,
        String(entry.exists),
        String(entry.fileCount),
        String(entry.bytes),
        entry.digest
      ].join("\t")
    )
    .join("\n");
  return sha256(Buffer.from(encoded, "utf8"));
}

function validLifecycleTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !ISO_UTC_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label} must be an ISO UTC timestamp`);
  }
  return value;
}

function validateLifecycleEvidenceDocument(input, details) {
  const {
    identity,
    installedEvidenceBundle,
    installerBytes,
    installerSha256,
    runtimeIdentity,
    runtimeIdentityBytes,
    runtimeIdentitySha256
  } = details;
  assertExactKeys(input, LIFECYCLE_TOP_LEVEL_KEYS, "lifecycle evidence");
  assertEqual(input.schemaVersion, 1, "Lifecycle evidence schemaVersion");
  assertEqual(input.result, "passed", "Lifecycle evidence result");
  assertEqual(
    input.evidenceBoundary,
    "developer-machine-uninstall-retention-and-same-installer-reinstall",
    "Lifecycle evidence boundary"
  );
  const testedAtUtc = validLifecycleTimestamp(
    input.testedAtUtc,
    "Lifecycle evidence testedAtUtc"
  );

  assertExactKeys(
    input.installer,
    LIFECYCLE_INSTALLER_KEYS,
    "lifecycle installer"
  );
  const installer = {
    path: requireString(input.installer.path, "lifecycle installer.path"),
    bytes: requireInteger(input.installer.bytes, "lifecycle installer.bytes", 1),
    sha256: requireHash(input.installer.sha256, "lifecycle installer.sha256")
  };
  assertEqual(
    installer.path,
    identity.installerFilename,
    "Lifecycle installer path"
  );
  assertEqual(installer.bytes, installerBytes, "Lifecycle installer bytes");
  assertEqual(
    installer.sha256,
    installerSha256,
    "Lifecycle installer SHA-256"
  );

  assertExactKeys(
    input.installedEvidence,
    LIFECYCLE_INSTALLED_EVIDENCE_KEYS,
    "lifecycle installedEvidence"
  );
  const installedEvidenceSource = Buffer.from(
    installedEvidenceBundle.evidenceSource,
    "utf8"
  );
  const installedEvidence = {
    path: requireString(
      input.installedEvidence.path,
      "lifecycle installedEvidence.path"
    ),
    bytes: requireInteger(
      input.installedEvidence.bytes,
      "lifecycle installedEvidence.bytes",
      1
    ),
    sha256: requireHash(
      input.installedEvidence.sha256,
      "lifecycle installedEvidence.sha256"
    ),
    testedAtUtc: validLifecycleTimestamp(
      input.installedEvidence.testedAtUtc,
      "lifecycle installedEvidence.testedAtUtc"
    )
  };
  assertEqual(
    installedEvidence.path,
    INSTALLED_EVIDENCE_FILENAME,
    "Lifecycle installed evidence path"
  );
  assertEqual(
    installedEvidence.bytes,
    installedEvidenceSource.length,
    "Lifecycle installed evidence bytes"
  );
  assertEqual(
    installedEvidence.sha256,
    installedEvidenceBundle.evidenceHash,
    "Lifecycle installed evidence SHA-256"
  );
  assertEqual(
    installedEvidence.testedAtUtc,
    installedEvidenceBundle.evidence.testedAtUtc,
    "Lifecycle installed evidence timestamp"
  );
  if (Date.parse(testedAtUtc) < Date.parse(installedEvidence.testedAtUtc)) {
    throw new Error(
      "Lifecycle evidence timestamp cannot precede installed evidence"
    );
  }

  assertExactKeys(
    input.identity,
    LIFECYCLE_IDENTITY_KEYS,
    "lifecycle identity"
  );
  const lifecycleIdentity = {
    version: requireString(input.identity.version, "lifecycle identity.version"),
    protocolVersion: requireInteger(
      input.identity.protocolVersion,
      "lifecycle identity.protocolVersion",
      1
    ),
    shellBuildId: requireString(
      input.identity.shellBuildId,
      "lifecycle identity.shellBuildId"
    ),
    sidecarBuildId: requireString(
      input.identity.sidecarBuildId,
      "lifecycle identity.sidecarBuildId"
    ),
    nodeVersion: requireString(
      input.identity.nodeVersion,
      "lifecycle identity.nodeVersion"
    ),
    nodeSha256: requireHash(
      input.identity.nodeSha256,
      "lifecycle identity.nodeSha256"
    ),
    runtimeIdentitySha256: requireHash(
      input.identity.runtimeIdentitySha256,
      "lifecycle identity.runtimeIdentitySha256"
    ),
    runtimeIdentityBytes: requireInteger(
      input.identity.runtimeIdentityBytes,
      "lifecycle identity.runtimeIdentityBytes",
      1
    )
  };
  for (const [actual, expected, label] of [
    [lifecycleIdentity.version, identity.version, "Lifecycle version"],
    [
      lifecycleIdentity.protocolVersion,
      identity.localProtocolVersion,
      "Lifecycle protocol version"
    ],
    [
      lifecycleIdentity.shellBuildId,
      runtimeIdentity.shellBuildId,
      "Lifecycle shell build ID"
    ],
    [
      lifecycleIdentity.sidecarBuildId,
      runtimeIdentity.sidecarBuildId,
      "Lifecycle sidecar build ID"
    ],
    [
      lifecycleIdentity.nodeVersion,
      identity.nodeRuntime.version,
      "Lifecycle Node version"
    ],
    [
      lifecycleIdentity.nodeSha256,
      identity.nodeRuntime.sha256,
      "Lifecycle Node SHA-256"
    ],
    [
      lifecycleIdentity.runtimeIdentitySha256,
      runtimeIdentitySha256,
      "Lifecycle runtime identity SHA-256"
    ],
    [
      lifecycleIdentity.runtimeIdentityBytes,
      runtimeIdentityBytes,
      "Lifecycle runtime identity bytes"
    ]
  ]) {
    assertEqual(actual, expected, label);
  }

  assertExactKeys(
    input.installation,
    LIFECYCLE_INSTALLATION_KEYS,
    "lifecycle installation"
  );
  const expectedExecutablePath =
    `${identity.windowsPathContracts.install}\\${identity.executableName}`;
  const installation = {
    installRoot: requireString(
      input.installation.installRoot,
      "lifecycle installation.installRoot"
    ),
    executablePath: requireString(
      input.installation.executablePath,
      "lifecycle installation.executablePath"
    ),
    executableBytesBefore: requireInteger(
      input.installation.executableBytesBefore,
      "lifecycle installation.executableBytesBefore",
      1
    ),
    executableSha256Before: requireHash(
      input.installation.executableSha256Before,
      "lifecycle installation.executableSha256Before"
    ),
    executableBytesAfter: requireInteger(
      input.installation.executableBytesAfter,
      "lifecycle installation.executableBytesAfter",
      1
    ),
    executableSha256After: requireHash(
      input.installation.executableSha256After,
      "lifecycle installation.executableSha256After"
    )
  };
  for (const [actual, expected, label] of [
    [
      installation.installRoot,
      identity.windowsPathContracts.install,
      "Lifecycle install root"
    ],
    [
      installation.executablePath,
      expectedExecutablePath,
      "Lifecycle executable path"
    ],
    [
      installation.executableBytesBefore,
      installedEvidenceBundle.evidence.installation.executableBytes,
      "Lifecycle pre-uninstall executable bytes"
    ],
    [
      installation.executableBytesAfter,
      installedEvidenceBundle.evidence.installation.executableBytes,
      "Lifecycle reinstalled executable bytes"
    ],
    [
      installation.executableSha256Before,
      installedEvidenceBundle.evidence.installation.executableSha256,
      "Lifecycle pre-uninstall executable SHA-256"
    ],
    [
      installation.executableSha256After,
      installedEvidenceBundle.evidence.installation.executableSha256,
      "Lifecycle reinstalled executable SHA-256"
    ]
  ]) {
    assertEqual(actual, expected, label);
  }

  assertExactKeys(input.backup, LIFECYCLE_BACKUP_KEYS, "lifecycle backup");
  const backup = {
    root: requirePortableRelativePath(input.backup.root, "lifecycle backup.root"),
    manifestPath: requirePortableRelativePath(
      input.backup.manifestPath,
      "lifecycle backup.manifestPath"
    ),
    manifestBytes: requireInteger(
      input.backup.manifestBytes,
      "lifecycle backup.manifestBytes",
      1
    ),
    manifestSha256: requireHash(
      input.backup.manifestSha256,
      "lifecycle backup.manifestSha256"
    ),
    fileCount: requireInteger(
      input.backup.fileCount,
      "lifecycle backup.fileCount"
    ),
    bytes: requireInteger(input.backup.bytes, "lifecycle backup.bytes"),
    sourceFingerprintDigest: requireHash(
      input.backup.sourceFingerprintDigest,
      "lifecycle backup.sourceFingerprintDigest"
    ),
    backupFingerprintDigest: requireHash(
      input.backup.backupFingerprintDigest,
      "lifecycle backup.backupFingerprintDigest"
    )
  };
  if (
    !/^artifacts\/review\/pre-uninstall-user-data-backup-\d{8}T\d{9}Z(?:-\d+)?$/u
      .test(backup.root)
  ) {
    throw new Error(
      "Lifecycle backup root must use the canonical pre-uninstall backup directory"
    );
  }
  assertEqual(
    backup.manifestPath,
    `${backup.root}/manifest.json`,
    "Lifecycle backup manifest path"
  );
  assertEqual(
    backup.backupFingerprintDigest,
    backup.sourceFingerprintDigest,
    "Lifecycle backup/source fingerprint digest"
  );

  const fingerprintsBefore = canonicalLifecycleFingerprints(
    input.userDataFingerprintsBefore,
    "lifecycle fingerprints before"
  );
  const fingerprintsAfterUninstall = canonicalLifecycleFingerprints(
    input.userDataFingerprintsAfterUninstall,
    "lifecycle fingerprints after uninstall"
  );
  const fingerprintsAfterReinstall = canonicalLifecycleFingerprints(
    input.userDataFingerprintsAfterReinstall,
    "lifecycle fingerprints after reinstall"
  );
  assertEqual(
    stableJson(fingerprintsAfterUninstall),
    stableJson(fingerprintsBefore),
    "Lifecycle pre/post-uninstall fingerprints"
  );
  assertEqual(
    stableJson(fingerprintsAfterReinstall),
    stableJson(fingerprintsBefore),
    "Lifecycle pre/post-reinstall fingerprints"
  );
  const fingerprintFileCount = fingerprintsBefore.reduce(
    (total, entry) => total + entry.fileCount,
    0
  );
  const fingerprintBytes = fingerprintsBefore.reduce(
    (total, entry) => total + entry.bytes,
    0
  );
  if (
    !Number.isSafeInteger(fingerprintFileCount) ||
    !Number.isSafeInteger(fingerprintBytes)
  ) {
    throw new Error("Lifecycle fingerprint totals exceed safe integer range");
  }
  assertEqual(
    backup.fileCount,
    fingerprintFileCount,
    "Lifecycle backup file count"
  );
  assertEqual(backup.bytes, fingerprintBytes, "Lifecycle backup bytes");
  const expectedFingerprintDigest =
    lifecycleFingerprintDigest(fingerprintsBefore);
  assertEqual(
    backup.sourceFingerprintDigest,
    expectedFingerprintDigest,
    "Lifecycle source fingerprint digest"
  );
  assertEqual(
    backup.backupFingerprintDigest,
    expectedFingerprintDigest,
    "Lifecycle backup fingerprint digest"
  );

  assertExactKeys(
    input.uninstall,
    LIFECYCLE_UNINSTALL_KEYS,
    "lifecycle uninstall"
  );
  const uninstall = {
    exitCode: requireInteger(
      input.uninstall.exitCode,
      "lifecycle uninstall.exitCode"
    ),
    installDirectoryRemoved: requireBoolean(
      input.uninstall.installDirectoryRemoved,
      "lifecycle uninstall.installDirectoryRemoved"
    ),
    registryKeyRemoved: requireBoolean(
      input.uninstall.registryKeyRemoved,
      "lifecycle uninstall.registryKeyRemoved"
    )
  };
  assertEqual(uninstall.exitCode, 0, "Lifecycle uninstall exit code");
  assertEqual(
    uninstall.installDirectoryRemoved,
    true,
    "Lifecycle install directory removal"
  );
  assertEqual(
    uninstall.registryKeyRemoved,
    true,
    "Lifecycle registry-key removal"
  );

  assertExactKeys(
    input.reinstall,
    LIFECYCLE_REINSTALL_KEYS,
    "lifecycle reinstall"
  );
  const reinstall = {
    exitCode: requireInteger(
      input.reinstall.exitCode,
      "lifecycle reinstall.exitCode"
    ),
    registryVersion: requireString(
      input.reinstall.registryVersion,
      "lifecycle reinstall.registryVersion"
    )
  };
  assertEqual(reinstall.exitCode, 0, "Lifecycle reinstall exit code");
  assertEqual(
    reinstall.registryVersion,
    identity.version,
    "Lifecycle reinstalled registry version"
  );

  assertExactKeys(
    input.runtime,
    LIFECYCLE_RUNTIME_KEYS,
    "lifecycle runtime"
  );
  const runtime = {
    dynamicPort: requireInteger(
      input.runtime.dynamicPort,
      "lifecycle runtime.dynamicPort",
      1
    ),
    oneSidecarProcess: requireBoolean(
      input.runtime.oneSidecarProcess,
      "lifecycle runtime.oneSidecarProcess"
    ),
    normalWindowCloseStopsSidecar: requireBoolean(
      input.runtime.normalWindowCloseStopsSidecar,
      "lifecycle runtime.normalWindowCloseStopsSidecar"
    )
  };
  if (runtime.dynamicPort > 65_535) {
    throw new Error("Lifecycle dynamic port must be a valid TCP port");
  }
  assertEqual(
    runtime.oneSidecarProcess,
    true,
    "Lifecycle one-sidecar result"
  );
  assertEqual(
    runtime.normalWindowCloseStopsSidecar,
    true,
    "Lifecycle sidecar shutdown result"
  );

  assertExactKeys(
    input.recovery,
    LIFECYCLE_RECOVERY_KEYS,
    "lifecycle recovery"
  );
  const recovery = {
    attempted: requireBoolean(
      input.recovery.attempted,
      "lifecycle recovery.attempted"
    ),
    installerExitCode: input.recovery.installerExitCode,
    applicationRestored: requireBoolean(
      input.recovery.applicationRestored,
      "lifecycle recovery.applicationRestored"
    )
  };
  assertEqual(recovery.attempted, false, "Lifecycle recovery attempted");
  assertEqual(
    recovery.installerExitCode,
    null,
    "Lifecycle recovery installer exit code"
  );
  assertEqual(
    recovery.applicationRestored,
    true,
    "Lifecycle recovery application restored"
  );

  return {
    schemaVersion: 1,
    result: "passed",
    testedAtUtc,
    evidenceBoundary: input.evidenceBoundary,
    installer,
    installedEvidence,
    identity: lifecycleIdentity,
    installation,
    backup,
    userDataFingerprintsBefore: fingerprintsBefore,
    userDataFingerprintsAfterUninstall: fingerprintsAfterUninstall,
    userDataFingerprintsAfterReinstall: fingerprintsAfterReinstall,
    uninstall,
    reinstall,
    runtime,
    recovery
  };
}

function createLifecycleEvidenceBundle(input, details) {
  const evidence = validateLifecycleEvidenceDocument(input, details);
  const evidenceSource = stableJson(evidence);
  const evidenceHash = sha256(Buffer.from(evidenceSource, "utf8"));
  const fingerprintLines = evidence.userDataFingerprintsBefore
    .map((entry, index) => {
      const afterUninstall =
        evidence.userDataFingerprintsAfterUninstall[index];
      const afterReinstall =
        evidence.userDataFingerprintsAfterReinstall[index];
      return `  - ${entry.label}: before=${entry.digest}; after-uninstall=${afterUninstall.digest}; after-reinstall=${afterReinstall.digest}; files=${entry.fileCount}; bytes=${entry.bytes}`;
    })
    .join("\n");
  const report = `# Uninstall retention and reinstall test - ${details.identity.displayName} ${details.identity.version}

Status: PASSED

- Release: ${details.identity.version}
- Installer SHA-256: ${details.installerSha256}
- Installed evidence: ${INSTALLED_EVIDENCE_FILENAME}
- Installed evidence SHA-256: ${evidence.installedEvidence.sha256}
- Lifecycle evidence: ${UNINSTALL_EVIDENCE_FILENAME}
- Lifecycle evidence SHA-256: ${evidenceHash}
- Tested at: ${evidence.testedAtUtc}
- Boundary: developer-machine current-user NSIS lifecycle; this is not clean-machine evidence.
- Uninstall: exit code ${evidence.uninstall.exitCode}; install directory removed; HKCU uninstall registry key removed.
- Retention: regular-file path, byte length, and SHA-256 fingerprints were identical before uninstall, after uninstall, and after same-installer reinstall before application launch.
- Backup: ${evidence.backup.root}; manifest SHA-256 ${evidence.backup.manifestSha256}; source/backup digest ${evidence.backup.sourceFingerprintDigest}.
- Reinstall: exit code ${evidence.reinstall.exitCode}; installed executable bytes/hash remained ${evidence.installation.executableBytesBefore}/${evidence.installation.executableSha256Before}.
- Runtime: one bundled sidecar process, dynamic loopback port ${evidence.runtime.dynamicPort}, and normal-window-close sidecar shutdown passed.
- Fingerprints:
${fingerprintLines}
`;
  return { evidence, evidenceHash, evidenceSource, report };
}

function backupInventoryPayload(files) {
  if (files.length === 0) return "";
  return JSON.stringify(files.length === 1 ? files[0] : files);
}

function canonicalBackupManifestFile(input, label) {
  assertExactKeys(input, BACKUP_MANIFEST_FILE_KEYS, label);
  return {
    path: requirePortableRelativePath(input.path, `${label}.path`),
    bytes: requireInteger(input.bytes, `${label}.bytes`),
    sha256: requireHash(input.sha256, `${label}.sha256`)
  };
}

function canonicalBackupManifest(input, evidence) {
  assertExactKeys(input, BACKUP_MANIFEST_KEYS, "lifecycle backup manifest");
  assertEqual(
    input.schemaVersion,
    1,
    "Lifecycle backup manifest schemaVersion"
  );
  assertEqual(
    input.inventorySemantics,
    "regular-file-relative-path-byte-length-sha256",
    "Lifecycle backup inventory semantics"
  );
  const createdAtUtc = validLifecycleTimestamp(
    input.createdAtUtc,
    "Lifecycle backup manifest createdAtUtc"
  );
  if (Date.parse(createdAtUtc) > Date.parse(evidence.testedAtUtc)) {
    throw new Error(
      "Lifecycle backup manifest timestamp cannot follow lifecycle evidence"
    );
  }
  if (!Array.isArray(input.roots)) {
    throw new Error("Lifecycle backup manifest roots must be an array");
  }
  assertEqual(
    input.roots.length,
    evidence.userDataFingerprintsBefore.length,
    "Lifecycle backup manifest root count"
  );
  const roots = input.roots.map((rootInput, rootIndex) => {
    const label = `lifecycle backup manifest roots[${rootIndex}]`;
    assertExactKeys(rootInput, BACKUP_MANIFEST_ROOT_KEYS, label);
    const fingerprint = evidence.userDataFingerprintsBefore[rootIndex];
    const root = {
      label: requireString(rootInput.label, `${label}.label`),
      exists: requireBoolean(rootInput.exists, `${label}.exists`),
      directory: requirePortableRelativePath(
        rootInput.directory,
        `${label}.directory`
      ),
      files: rootInput.files
    };
    assertEqual(
      root.label,
      fingerprint.label,
      `${label}.label`
    );
    assertEqual(
      root.exists,
      fingerprint.exists,
      `${label}.exists`
    );
    assertEqual(
      root.directory,
      `data/root-${String(rootIndex).padStart(2, "0")}`,
      `${label}.directory`
    );
    if (!Array.isArray(root.files)) {
      throw new Error(`${label}.files must be an array`);
    }
    const files = root.files.map((file, fileIndex) =>
      canonicalBackupManifestFile(file, `${label}.files[${fileIndex}]`)
    );
    const filePaths = new Set(files.map((file) => file.path));
    if (filePaths.size !== files.length) {
      throw new Error(`${label}.files must contain unique paths`);
    }
    if (!root.exists && files.length !== 0) {
      throw new Error(`${label}.files must be empty for a missing root`);
    }
    const fileBytes = files.reduce(
      (total, file) => total + file.bytes,
      0
    );
    if (!Number.isSafeInteger(fileBytes)) {
      throw new Error(`${label}.files byte total exceeds safe integer range`);
    }
    assertEqual(
      files.length,
      fingerprint.fileCount,
      `${label}.files count`
    );
    assertEqual(fileBytes, fingerprint.bytes, `${label}.files bytes`);
    assertEqual(
      sha256(Buffer.from(backupInventoryPayload(files), "utf8")),
      fingerprint.digest,
      `${label}.files inventory digest`
    );
    return {
      label: root.label,
      exists: root.exists,
      directory: root.directory,
      files
    };
  });

  assertExactKeys(
    input.summary,
    BACKUP_MANIFEST_SUMMARY_KEYS,
    "lifecycle backup manifest summary"
  );
  const summary = {
    fileCount: requireInteger(
      input.summary.fileCount,
      "lifecycle backup manifest summary.fileCount"
    ),
    bytes: requireInteger(
      input.summary.bytes,
      "lifecycle backup manifest summary.bytes"
    ),
    sourceFingerprintDigest: requireHash(
      input.summary.sourceFingerprintDigest,
      "lifecycle backup manifest summary.sourceFingerprintDigest"
    ),
    backupFingerprintDigest: requireHash(
      input.summary.backupFingerprintDigest,
      "lifecycle backup manifest summary.backupFingerprintDigest"
    )
  };
  for (const [actual, expected, label] of [
    [
      summary.fileCount,
      evidence.backup.fileCount,
      "Lifecycle backup manifest file count"
    ],
    [
      summary.bytes,
      evidence.backup.bytes,
      "Lifecycle backup manifest bytes"
    ],
    [
      summary.sourceFingerprintDigest,
      evidence.backup.sourceFingerprintDigest,
      "Lifecycle backup manifest source digest"
    ],
    [
      summary.backupFingerprintDigest,
      evidence.backup.backupFingerprintDigest,
      "Lifecycle backup manifest backup digest"
    ]
  ]) {
    assertEqual(actual, expected, label);
  }
  return {
    schemaVersion: 1,
    createdAtUtc,
    inventorySemantics: input.inventorySemantics,
    roots,
    summary
  };
}

async function collectBackupRegularFiles(directory, realBackupRoot) {
  const files = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    const currentInformation = await lstat(current, { bigint: true });
    if (currentInformation.isSymbolicLink()) {
      throw new Error("Lifecycle backup contains a symbolic link");
    }
    if (!currentInformation.isDirectory()) {
      throw new Error("Lifecycle backup inventory root must be a directory");
    }
    const realCurrent = await realpath(current);
    assertInsideRoot(
      realBackupRoot,
      realCurrent,
      "Lifecycle backup directory real path"
    );
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolutePath = resolve(current, entry.name);
      const before = await lstat(absolutePath, { bigint: true });
      if (before.isSymbolicLink()) {
        throw new Error("Lifecycle backup contains a symbolic link");
      }
      const realEntryBefore = await realpath(absolutePath);
      assertInsideRoot(
        realBackupRoot,
        realEntryBefore,
        "Lifecycle backup entry real path"
      );
      if (before.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!before.isFile()) {
        throw new Error("Lifecycle backup contains a non-regular entry");
      }
      const handle = await open(absolutePath, "r");
      let data;
      let opened;
      let openedAfter;
      try {
        opened = await handle.stat({ bigint: true });
        data = await handle.readFile();
        openedAfter = await handle.stat({ bigint: true });
      } finally {
        await handle.close();
      }
      const [after, realEntryAfter] = await Promise.all([
        lstat(absolutePath, { bigint: true }),
        realpath(absolutePath)
      ]);
      if (
        !opened.isFile() ||
        opened.ino !== before.ino ||
        opened.size !== before.size ||
        openedAfter.dev !== opened.dev ||
        openedAfter.ino !== opened.ino ||
        openedAfter.size !== opened.size ||
        openedAfter.mtimeNs !== opened.mtimeNs ||
        openedAfter.ctimeNs !== opened.ctimeNs ||
        after.isSymbolicLink() ||
        !after.isFile() ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs ||
        realEntryAfter !== realEntryBefore
      ) {
        throw new Error("Lifecycle backup file changed while being verified");
      }
      assertInsideRoot(
        realBackupRoot,
        realEntryAfter,
        "Lifecycle backup file real path"
      );
      const relativePath = normalizeRelativePath(
        relative(directory, absolutePath)
      );
      requirePortableRelativePath(
        relativePath,
        "Lifecycle backup regular-file path"
      );
      files.push({
        path: relativePath,
        bytes: data.length,
        sha256: sha256(data)
      });
    }
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

async function verifyLifecycleBackupManifest(evidence, root) {
  const backupRoot = resolve(root, ...evidence.backup.root.split("/"));
  const manifestPath = resolve(
    root,
    ...evidence.backup.manifestPath.split("/")
  );
  assertInsideRoot(root, backupRoot, "Lifecycle backup root");
  assertInsideRoot(root, manifestPath, "Lifecycle backup manifest");
  assertEqual(
    dirname(manifestPath),
    backupRoot,
    "Lifecycle backup manifest directory"
  );
  const [
    realRoot,
    realBackupRoot,
    realManifestPath,
    backupInformation,
    manifestInformation,
    manifestData
  ] = await Promise.all([
    realpath(root),
    realpath(backupRoot),
    realpath(manifestPath),
    lstat(backupRoot, { bigint: true }),
    lstat(manifestPath, { bigint: true }),
    readFile(manifestPath)
  ]);
  if (backupInformation.isSymbolicLink() || !backupInformation.isDirectory()) {
    throw new Error("Lifecycle backup root must be a non-link directory");
  }
  if (
    manifestInformation.isSymbolicLink() ||
    !manifestInformation.isFile()
  ) {
    throw new Error("Lifecycle backup manifest must be a non-link regular file");
  }
  assertInsideRoot(realRoot, realBackupRoot, "Lifecycle backup real path");
  assertInsideRoot(realRoot, realManifestPath, "Lifecycle manifest real path");
  assertEqual(
    dirname(realManifestPath),
    realBackupRoot,
    "Lifecycle backup manifest real directory"
  );
  assertEqual(
    manifestData.length,
    evidence.backup.manifestBytes,
    "Lifecycle backup manifest bytes"
  );
  assertEqual(
    sha256(manifestData),
    evidence.backup.manifestSha256,
    "Lifecycle backup manifest SHA-256"
  );
  const manifest = canonicalBackupManifest(
    parseJsonBuffer(manifestData),
    evidence
  );

  const expectedTopLevelNames = [
    "manifest.json",
    ...(manifest.roots.some((entry) => entry.exists) ? ["data"] : [])
  ].sort();
  const topLevelEntries = await readdir(backupRoot, { withFileTypes: true });
  const topLevelNames = topLevelEntries
    .map((entry) => entry.name)
    .sort();
  assertEqual(
    stableJson(topLevelNames),
    stableJson(expectedTopLevelNames),
    "Lifecycle backup top-level entries"
  );
  const expectedExistingRoots = manifest.roots.filter((entry) => entry.exists);
  if (expectedExistingRoots.length > 0) {
    const dataDirectory = resolve(backupRoot, "data");
    const [dataInformation, realDataDirectory] = await Promise.all([
      lstat(dataDirectory, { bigint: true }),
      realpath(dataDirectory)
    ]);
    if (dataInformation.isSymbolicLink() || !dataInformation.isDirectory()) {
      throw new Error("Lifecycle backup data root must be a non-link directory");
    }
    assertInsideRoot(
      realBackupRoot,
      realDataDirectory,
      "Lifecycle backup data real path"
    );
    const dataEntries = await readdir(dataDirectory, {
      withFileTypes: true
    });
    const actualRootNames = dataEntries.map((entry) => entry.name).sort();
    const expectedRootNames = expectedExistingRoots
      .map((entry) => entry.directory.slice("data/".length))
      .sort();
    assertEqual(
      stableJson(actualRootNames),
      stableJson(expectedRootNames),
      "Lifecycle backup data-root entries"
    );
  }

  for (const manifestRoot of manifest.roots) {
    const rootDirectory = resolve(
      backupRoot,
      ...manifestRoot.directory.split("/")
    );
    assertInsideRoot(
      backupRoot,
      rootDirectory,
      "Lifecycle backup inventory directory"
    );
    if (!manifestRoot.exists) {
      try {
        await lstat(rootDirectory);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          continue;
        }
        throw error;
      }
      throw new Error(
        "Lifecycle backup contains a directory for a missing source root"
      );
    }
    const actualFiles = await collectBackupRegularFiles(
      rootDirectory,
      realBackupRoot
    );
    assertEqual(
      actualFiles.length,
      manifestRoot.files.length,
      `Lifecycle backup file count for ${manifestRoot.label}`
    );
    const actualByPath = new Map(
      actualFiles.map((file) => [file.path, file])
    );
    for (const expectedFile of manifestRoot.files) {
      assertEqual(
        stableJson(actualByPath.get(expectedFile.path)),
        stableJson(expectedFile),
        `Lifecycle backup file ${manifestRoot.label}/${expectedFile.path}`
      );
    }
  }
}

async function matchingInstalledEvidenceBundle(path, details) {
  const data = await optionalFile(path);
  if (data === null) return null;

  try {
    const bundle = createInstalledEvidenceBundle(parseJsonBuffer(data), {
      identity: details.identity,
      installerBytes: details.installerBytes,
      installerSha256: details.installerSha256,
      shellBuildId: details.runtimeIdentity.shellBuildId,
      sidecarBuildId: details.runtimeIdentity.sidecarBuildId
    });
    await verifyLifecycleBackupManifest(
      {
        backup: bundle.evidence.upgrade.preUpgradeBackup,
        testedAtUtc: bundle.evidence.testedAtUtc,
        userDataFingerprintsBefore:
          bundle.evidence.upgrade.userDataFingerprintsBefore
      },
      details.root
    );
    await writeFile(path, bundle.evidenceSource, "utf8");
    return bundle;
  } catch {
    // A malformed or stale managed evidence file is removed below.
  }

  await rm(path, { force: true });
  return null;
}

async function matchingLifecycleEvidenceBundle(
  evidencePath,
  reportPath,
  details
) {
  const evidenceData = await optionalFile(evidencePath);
  if (evidenceData === null) {
    await rm(reportPath, { force: true });
    return null;
  }

  try {
    const bundle = createLifecycleEvidenceBundle(
      parseJsonBuffer(evidenceData),
      details
    );
    await verifyLifecycleBackupManifest(bundle.evidence, details.root);
    await Promise.all([
      writeFile(evidencePath, bundle.evidenceSource, "utf8"),
      writeFile(reportPath, bundle.report, "utf8")
    ]);
    return bundle;
  } catch {
    // A malformed or stale managed lifecycle record is removed below.
  }

  await Promise.all([
    rm(evidencePath, { force: true }),
    rm(reportPath, { force: true })
  ]);
  return null;
}

function runtimeIdentityErrors(identity, runtimeIdentity) {
  const errors = [];
  for (const [field, expected] of [
    ["product", identity.displayName],
    ["version", identity.version],
    ["schemaVersion", identity.projectSchemaVersion],
    ["protocolVersion", identity.localProtocolVersion]
  ]) {
    if (runtimeIdentity[field] !== expected) {
      errors.push(
        `src-tauri/resources/identity.json ${field} is ${runtimeIdentity[field] ?? "missing"}; expected ${expected}`
      );
    }
  }
  if (runtimeIdentity.buildId !== runtimeIdentity.shellBuildId) {
    errors.push("runtime buildId must equal shellBuildId");
  }
  if (!/^desktop-[a-f0-9]{20}$/u.test(runtimeIdentity.shellBuildId ?? "")) {
    errors.push("runtime shellBuildId is invalid");
  }
  if (!/^sidecar-[a-f0-9]{20}$/u.test(runtimeIdentity.sidecarBuildId ?? "")) {
    errors.push("runtime sidecarBuildId is invalid");
  }
  if (runtimeIdentity.nodeVersion !== identity.nodeRuntime.version) {
    errors.push(
      `runtime nodeVersion is ${runtimeIdentity.nodeVersion ?? "missing"}; expected ${identity.nodeRuntime.version}`
    );
  }
  const nodeEntries = Array.isArray(runtimeIdentity.files)
    ? runtimeIdentity.files.filter((entry) => entry?.path === "sidecar/node.exe")
    : [];
  if (
    nodeEntries.length !== 1 ||
    nodeEntries[0].sha256 !== identity.nodeRuntime.sha256
  ) {
    errors.push("runtime sidecar/node.exe does not match the pinned Node SHA-256");
  }
  return errors;
}

function createKnownLimitations({
  buildDate,
  identity,
  installerPresent,
  licenseInventory,
  sourceState
}) {
  const installerLine = installerPresent
    ? "The installer is present and hashed, but this generator does not itself execute installation, upgrade, repair, uninstall, or clean-VM tests."
    : "No installer was present when this evidence bundle was generated; installer and installed-runtime qualification remain unexecuted.";
  const dirtyLine = sourceState.dirty
    ? `The evidence was generated from a dirty working tree (${sourceState.dirtyFiles.length} recorded path entries); the commit SHA alone does not reproduce the uncommitted changes.`
    : "The evidence generator observed a clean Git working tree.";
  const signingLine =
    identity.signing.status === "signed-release"
      ? "The installer signing policy is signed-release; Authenticode validity and timestamp evidence must still be verified on the clean Windows runner."
      : "This is an unsigned preview. Windows may show reputation or SmartScreen warnings, and the legal code-signing publisher is still pending user confirmation.";
  const webView2Line =
    identity.webView2.policy === "offline-evergreen"
      ? `WebView2 uses the offline Evergreen \`${identity.webView2.installMode}\` policy; clean-image offline installation remains an external qualification gate.`
      : `WebView2 uses the online-light \`${identity.webView2.installMode}\` policy. A machine without WebView2 needs network access during installation; offline installation is not covered by this package.`;
  return `# Known limitations — ${identity.displayName} ${identity.version}

Evidence date: ${buildDate}

- ${signingLine}
- ${webView2Line}
- ${installerLine}
- Developer-machine evidence is not clean-machine evidence. Standard-user, CJK-path, DPI, offline, downgrade, repair, and abrupt-termination matrix rows remain unexecuted unless a separate report is present.
- The official Node.js ${identity.nodeRuntime.version} license and third-party notices are bundled and hash-verified. The remaining inventory contains ${licenseInventory.summary.totalPackages} locked package/runtime entries, including ${licenseInventory.summary.noAssertion} \`NOASSERTION\` entries; exact upstream texts still require legal review before external distribution.
- ${dirtyLine}
`;
}

function defaultTestReport({
  identity,
  installerSha256,
  kind
}) {
  const isSmoke = kind === "smoke";
  return `# ${isSmoke ? "Packaged app smoke test" : "Upgrade test"} — ${identity.displayName} ${identity.version}

Status: NOT RUN

- Release: ${identity.version}
- Installer SHA-256: ${installerSha256 ?? "absent"}
- Installed evidence SHA-256: absent
- Scope: ${isSmoke ? "Installed shell, sidecar lifecycle, startup ritual, and single-instance behavior." : "Upgrade installation and user-data preservation."}
- Boundary: This placeholder must be replaced by recorded installed-app evidence. Package generation alone is not a passed runtime test.
`;
}

async function writeDefaultTestReport(path, details) {
  await writeFile(path, defaultTestReport(details), "utf8");
}

async function collectFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, relativePath));
    } else if (entry.isFile() && relativePath !== MANIFEST_FILENAME) {
      files.push({ absolutePath, path: relativePath });
    }
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

async function artifactRecord(file) {
  const data = await readFile(file.absolutePath);
  return {
    bytes: data.length,
    path: normalizeRelativePath(file.path),
    sha256: sha256(data)
  };
}

function inputRecord(root, path, data) {
  return {
    bytes: data.length,
    path: normalizeRelativePath(relative(root, path)),
    sha256: sha256(data)
  };
}

export async function generateReleaseEvidence(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const suppliedSourceState = options.sourceState ?? detectSourceState(root);
  if (!/^[a-f0-9]{40}$/u.test(suppliedSourceState.commit)) {
    throw new Error("sourceState.commit must be a full 40-character lowercase Git SHA");
  }
  if (
    typeof suppliedSourceState.dirty !== "boolean" ||
    !Array.isArray(suppliedSourceState.dirtyFiles) ||
    suppliedSourceState.dirtyFiles.some((path) => typeof path !== "string")
  ) {
    throw new Error("sourceState must contain dirty and dirtyFiles evidence");
  }
  const sourceState = {
    commit: suppliedSourceState.commit,
    dirty: suppliedSourceState.dirty,
    dirtyFiles: suppliedSourceState.dirtyFiles
      .map(normalizeRelativePath)
      .sort(),
    worktreeFingerprint:
      suppliedSourceState.worktreeFingerprint ??
      sha256(stableJson({
        commit: suppliedSourceState.commit,
        dirty: suppliedSourceState.dirty,
        dirtyFiles: suppliedSourceState.dirtyFiles
      })),
    worktreeFingerprintScope:
      suppliedSourceState.worktreeFingerprintScope ?? "supplied-source-state"
  };
  if (sourceState.dirty !== (sourceState.dirtyFiles.length > 0)) {
    throw new Error("sourceState.dirty must agree with sourceState.dirtyFiles");
  }
  if (!/^[a-f0-9]{64}$/u.test(sourceState.worktreeFingerprint)) {
    throw new Error("sourceState.worktreeFingerprint must be a SHA-256 value");
  }
  const buildDate = resolveBuildDate(options, root);
  const toolVersions = options.toolVersions ?? detectToolVersions();

  await verifyReleaseIdentityRepository({ root });
  const paths = {
    cargoLock: resolve(root, "src-tauri/Cargo.lock"),
    identity: resolve(root, "release/identity.json"),
    packageJson: resolve(root, "package.json"),
    packageLock: resolve(root, "package-lock.json"),
    runtimeIdentity: resolve(root, "src-tauri/resources/identity.json"),
    tauriConfig: resolve(root, "src-tauri/tauri.conf.json")
  };
  const [
    identityData,
    packageJsonData,
    packageLockData,
    cargoLockData,
    tauriConfigData,
    runtimeIdentityData
  ] = await Promise.all([
    readFile(paths.identity),
    readFile(paths.packageJson),
    readFile(paths.packageLock),
    readFile(paths.cargoLock),
    readFile(paths.tauriConfig),
    readFile(paths.runtimeIdentity)
  ]);
  const identity = validateReleaseIdentityDocument(JSON.parse(identityData));
  const packageJson = JSON.parse(packageJsonData);
  const packageLock = JSON.parse(packageLockData);
  const tauriConfig = JSON.parse(tauriConfigData);
  const runtimeIdentity = options.runtimeIdentity ?? JSON.parse(runtimeIdentityData);
  const runtimeErrors = runtimeIdentityErrors(identity, runtimeIdentity);
  if (runtimeErrors.length > 0) {
    throw new Error(
      `Runtime release identity mismatch:\n${runtimeErrors
        .map((error) => `- ${error}`)
        .join("\n")}`
    );
  }
  if (
    packageJson.version !== identity.version ||
    packageLock.version !== identity.version
  ) {
    throw new Error("package.json/package-lock.json do not match canonical version");
  }
  const nodeLicensePath = resolve(root, identity.nodeRuntime.licensePath);
  assertInsideRoot(root, nodeLicensePath, "Pinned Node license path");
  const nodeLicenseData = await readFile(nodeLicensePath);
  if (sha256(nodeLicenseData) !== identity.nodeRuntime.licenseSha256) {
    throw new Error("Pinned Node license SHA-256 does not match canonical identity");
  }

  const cargoPackages = parseCargoLockPackages(cargoLockData.toString("utf8"));
  const tauriPackage = cargoPackages.find((entry) => entry.name === "tauri");
  if (tauriPackage === undefined) {
    throw new Error("src-tauri/Cargo.lock does not contain the tauri package");
  }
  if (
    tauriConfig.bundle?.windows?.webviewInstallMode?.type !==
    identity.webView2.installMode
  ) {
    throw new Error("Tauri WebView2 policy does not match canonical release identity");
  }

  const outputDirectory = resolve(root, identity.releaseDirectory);
  assertInsideRoot(root, outputDirectory, "Canonical release directory");
  const licensesDirectory = resolve(outputDirectory, "licenses");
  assertInsideRoot(outputDirectory, licensesDirectory, "License directory");
  await assertNoLinkAncestors(
    root,
    outputDirectory,
    "Canonical release directory"
  );
  await mkdir(outputDirectory, { recursive: true });
  const realRepositoryRoot = await assertNoLinkAncestors(
    root,
    outputDirectory,
    "Canonical release directory"
  );
  await assertNoLinksInTree(
    outputDirectory,
    realRepositoryRoot,
    "Canonical release directory"
  );
  await rm(licensesDirectory, { force: true, recursive: true });
  await mkdir(licensesDirectory, { recursive: true });
  await assertNoLinkAncestors(
    root,
    licensesDirectory,
    "License directory"
  );

  const installerPath = resolve(outputDirectory, identity.installerFilename);
  const installerData = await optionalFile(installerPath);
  let installerMetadata = null;
  if (installerData !== null) {
    const expectedAuthenticodeStatus =
      identity.signing.status === "signed-release" ? "Valid" : "NotSigned";
    const minimumInstallerBytes =
      options.minimumInstallerBytes ?? DEFAULT_MINIMUM_INSTALLER_BYTES;
    if (
      installerData.length < minimumInstallerBytes ||
      installerData[0] !== 0x4d ||
      installerData[1] !== 0x5a
    ) {
      throw new Error("Release installer is not a valid MZ executable of the expected size");
    }
    installerMetadata =
      options.installerMetadata ??
      inspectInstallerMetadata(installerPath, installerData, root);
    for (const [field, expected] of [
      ["peMachine", "I386"],
      ["authenticodeStatus", expectedAuthenticodeStatus],
      ["productName", identity.displayName],
      ["fileDescription", identity.displayName],
      ["productVersion", identity.version],
      ["fileVersion", identity.version]
    ]) {
      if (installerMetadata[field] !== expected) {
        throw new Error(
          `Installer ${field} is ${installerMetadata[field] ?? "missing"}; expected ${expected}`
        );
      }
    }
  }
  for (const entry of await readdir(outputDirectory, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".exe") &&
      entry.name !== identity.installerFilename
    ) {
      throw new Error(`Unexpected executable in canonical release directory: ${entry.name}`);
    }
  }

  const inventory = createLicenseInventory({
    buildDate: buildDate.value,
    cargoLock: cargoLockData.toString("utf8"),
    nodeVersion: runtimeIdentity.nodeVersion,
    packageLock
  });
  await Promise.all([
    writeJson(resolve(licensesDirectory, "dependency-licenses.json"), inventory),
    writeFile(
      resolve(licensesDirectory, "README.md"),
      createLicenseReadme(inventory),
      "utf8"
    ),
    writeFile(
      resolve(licensesDirectory, "THIRD-PARTY-NOTICES.md"),
      createThirdPartyNotices(inventory),
      "utf8"
    ),
    writeFile(
      resolve(licensesDirectory, basename(identity.nodeRuntime.licensePath)),
      nodeLicenseData
    )
  ]);

  const inputRecords = [
    inputRecord(root, paths.cargoLock, cargoLockData),
    inputRecord(root, paths.identity, identityData),
    inputRecord(root, paths.packageJson, packageJsonData),
    inputRecord(root, paths.packageLock, packageLockData),
    inputRecord(root, nodeLicensePath, nodeLicenseData),
    inputRecord(root, paths.runtimeIdentity, runtimeIdentityData),
    inputRecord(root, paths.tauriConfig, tauriConfigData)
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
  const inputFingerprint = sha256(stableJson({
    inputs: inputRecords,
    worktreeFingerprint: sourceState.worktreeFingerprint
  }));
  const spdx = createSpdxDocument({
    buildDate: buildDate.value,
    identity,
    inputFingerprint,
    inventory,
    sourceState
  });
  await writeJson(resolve(outputDirectory, "SBOM.spdx.json"), spdx);

  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const provenance = {
    schemaVersion: 1,
    product: identity.displayName,
    version: identity.version,
    buildDate: buildDate.value,
    buildDateSource: buildDate.source,
    source: sourceState,
    builder: {
      architecture,
      platform,
      targetTriple: options.targetTriple ?? targetTriple(platform, architecture),
      tools: {
        ...toolVersions,
        tauri: tauriPackage.version
      }
    },
    invocation:
      options.invocation ?? "node scripts/package-release.mjs",
    sourceInstaller: options.sourceInstaller ?? null,
    reproducibility: {
      deterministicJsonKeyOrder: true,
      inputFingerprint,
      lockfiles: ["package-lock.json", "src-tauri/Cargo.lock"]
    },
    inputs: inputRecords
  };
  await writeJson(resolve(outputDirectory, "build-provenance.json"), provenance);
  await writeFile(
    resolve(outputDirectory, "known-limitations.md"),
    createKnownLimitations({
      buildDate: buildDate.value,
      identity,
      installerPresent: installerData !== null,
      licenseInventory: inventory,
      sourceState
    }),
    "utf8"
  );

  const checksumPath = resolve(
    outputDirectory,
    `${identity.installerFilename}.sha256`
  );
  if (installerData === null) {
    await rm(checksumPath, { force: true });
  } else {
    await writeFile(
      checksumPath,
      `${sha256(installerData)}  ${identity.installerFilename}\n`,
      "utf8"
    );
  }

  const installerSha256 = installerData === null ? null : sha256(installerData);
  const installedEvidencePath = resolve(
    outputDirectory,
    INSTALLED_EVIDENCE_FILENAME
  );
  let installedEvidenceBundle = null;
  if (installerData === null) {
    await rm(installedEvidencePath, { force: true });
  } else {
    installedEvidenceBundle = await matchingInstalledEvidenceBundle(
      installedEvidencePath,
      {
        identity,
        installerBytes: installerData.length,
        installerSha256,
        root,
        runtimeIdentity
      }
    );
  }
  const uninstallEvidencePath = resolve(
    outputDirectory,
    UNINSTALL_EVIDENCE_FILENAME
  );
  const uninstallReportPath = resolve(
    outputDirectory,
    UNINSTALL_REPORT_FILENAME
  );
  if (installerData === null || installedEvidenceBundle === null) {
    await Promise.all([
      rm(uninstallEvidencePath, { force: true }),
      rm(uninstallReportPath, { force: true })
    ]);
  } else {
    await matchingLifecycleEvidenceBundle(
      uninstallEvidencePath,
      uninstallReportPath,
      {
        identity,
        installedEvidenceBundle,
        installerBytes: installerData.length,
        installerSha256,
        root,
        runtimeIdentity,
        runtimeIdentityBytes: runtimeIdentityData.length,
        runtimeIdentitySha256: sha256(runtimeIdentityData)
      }
    );
  }
  if (installedEvidenceBundle === null) {
    await Promise.all([
      writeDefaultTestReport(
        resolve(outputDirectory, SMOKE_REPORT_FILENAME),
        {
          identity,
          installerSha256,
          kind: "smoke"
        }
      ),
      writeDefaultTestReport(
        resolve(outputDirectory, UPGRADE_REPORT_FILENAME),
        {
          identity,
          installerSha256,
          kind: "upgrade"
        }
      )
    ]);
  } else {
    await Promise.all([
      writeFile(
        resolve(outputDirectory, SMOKE_REPORT_FILENAME),
        installedEvidenceBundle.smoke,
        "utf8"
      ),
      writeFile(
        resolve(outputDirectory, UPGRADE_REPORT_FILENAME),
        installedEvidenceBundle.upgrade,
        "utf8"
      )
    ]);
  }

  const artifacts = await Promise.all(
    (await collectFiles(outputDirectory)).map(artifactRecord)
  );
  const installerArtifact = artifacts.find(
    (artifact) => artifact.path === identity.installerFilename
  ) ?? null;
  const installer = installerArtifact === null
    ? null
    : { ...installerArtifact, ...installerMetadata };
  const manifest = {
    schemaVersion: 3,
    packageType: "tauri-nsis",
    product: identity.displayName,
    shortName: identity.shortName,
    identifier: identity.identifier,
    version: identity.version,
    commit: sourceState.commit,
    dirty: sourceState.dirty,
    buildDate: buildDate.value,
    platform: platform === "win32" ? "windows" : platform,
    architecture,
    targetTriple: provenance.builder.targetTriple,
    tauriVersion: tauriPackage.version,
    projectSchemaVersion: identity.projectSchemaVersion,
    upgradeFromVersion: identity.upgradeFromVersion,
    upgradeFrom: identity.upgradeFrom,
    localProtocolVersion: identity.localProtocolVersion,
    protocolVersion: runtimeIdentity.protocolVersion,
    buildId: runtimeIdentity.buildId,
    shellBuildId: runtimeIdentity.shellBuildId,
    sidecarBuildId: runtimeIdentity.sidecarBuildId,
    nodeVersion: runtimeIdentity.nodeVersion,
    webView2: identity.webView2,
    signed: installerMetadata?.authenticodeStatus === "Valid",
    signingStatus: identity.signing.status,
    legalPublisherStatus: identity.signing.legalPublisherStatus,
    sourceInstaller: options.sourceInstaller ?? null,
    installerStatus: installer === null ? "absent" : "present",
    installer,
    artifactHashAlgorithm: "SHA-256",
    hashCoverage:
      "Every regular file in this release directory except release-manifest.json itself.",
    artifacts
  };
  await writeJson(resolve(outputDirectory, MANIFEST_FILENAME), manifest);

  return { manifest, outputDirectory };
}

function parseArguments(argv) {
  const options = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--root requires a path");
      }
      options.root = isAbsolute(value) ? value : resolve(process.cwd(), value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await generateReleaseEvidence(parseArguments(process.argv.slice(2)));
    console.log(`Release evidence generated: ${result.outputDirectory}`);
    console.log(
      `Installer: ${result.manifest.installerStatus}; artifacts hashed: ${result.manifest.artifacts.length}`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
