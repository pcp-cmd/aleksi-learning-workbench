#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const INSTALLED_EVIDENCE_FILENAME =
  "installed-desktop-evidence.json";

const TOP_LEVEL_KEYS = [
  "evidenceBoundary",
  "identity",
  "installation",
  "installer",
  "result",
  "runtime",
  "schemaVersion",
  "testedAtUtc",
  "upgrade"
];
const INSTALLER_KEYS = [
  "authenticodeStatus",
  "bytes",
  "manifestPath",
  "path",
  "peMachine",
  "sha256"
];
const UPGRADE_KEYS = [
  "installedVersion",
  "preUpgradeBackup",
  "predecessorInstallation",
  "predecessorInstaller",
  "previousVersion",
  "userDataFingerprintsAfter",
  "userDataFingerprintsBefore",
  "userDataPreservedByInstaller"
];
const PRE_UPGRADE_BACKUP_KEYS = [
  "backupFingerprintDigest",
  "bytes",
  "fileCount",
  "manifestBytes",
  "manifestPath",
  "manifestSha256",
  "root",
  "sourceFingerprintDigest"
];
const PREDECESSOR_INSTALLER_KEYS = [
  "authenticodeStatus",
  "bytes",
  "path",
  "peMachine",
  "sha256",
  "version"
];
const PREDECESSOR_INSTALLATION_KEYS = [
  "executableAuthenticodeStatus",
  "executableBytes",
  "executablePath",
  "executableSha256",
  "version"
];
const FINGERPRINT_KEYS = [
  "bytes",
  "digest",
  "exists",
  "fileCount",
  "label"
];
const IDENTITY_KEYS = [
  "nodeSha256",
  "nodeVersion",
  "product",
  "protocolVersion",
  "schemaVersion",
  "shellBuildId",
  "sidecarBuildId",
  "version"
];
const INSTALLATION_KEYS = [
  "bytes",
  "executableAuthenticodeStatus",
  "executableBytes",
  "executablePath",
  "executableSha256",
  "fileCount",
  "installRoot",
  "uninstallerAuthenticodeStatus",
  "uninstallerBytes",
  "uninstallerPath",
  "uninstallerPeMachine",
  "uninstallerSha256"
];
const RUNTIME_KEYS = [
  "apiVerification",
  "coldMemory",
  "coldReadyMilliseconds",
  "coldRitualSurvivalMilliseconds",
  "firstDynamicPort",
  "forcedShellTerminationStopsSidecar",
  "forcedTerminationDynamicPort",
  "normalWindowCloseStopsSidecar",
  "secondDynamicPort",
  "singleInstance",
  "startupRitualSeconds",
  "warmMemory",
  "warmReadyMilliseconds",
  "warmRitualSurvivalMilliseconds"
];
const MEMORY_KEYS = [
  "shellWorkingSetBytes",
  "sidecarProcessCount",
  "sidecarWorkingSetBytes"
];
const REQUIRED_FINGERPRINT_LABELS = [
  "%APPDATA%\\Aleksi Learning Workbench",
  "%APPDATA%\\io.aleksi.workbench",
  "%LOCALAPPDATA%\\io.aleksi.workbench",
  "%USERPROFILE%\\Documents\\Aleksi Learning Workbench"
];
const OPTIONAL_FINGERPRINT_LABEL = "<ACTIVE_LEARNING_LIBRARY>";
const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/u;

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

async function readJson(path) {
  const source = await readFile(path, "utf8");
  return JSON.parse(source.replace(/^\uFEFF/u, ""));
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
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
  return value;
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum}`);
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
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a portable relative path`);
  }
  return path;
}

function canonicalFingerprint(input, label) {
  assertExactKeys(input, FINGERPRINT_KEYS, label);
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

function canonicalFingerprints(input, label) {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array`);
  }
  const byLabel = new Map();
  for (const [index, value] of input.entries()) {
    const fingerprint = canonicalFingerprint(value, `${label}[${index}]`);
    if (byLabel.has(fingerprint.label)) {
      throw new Error(`${label} contains duplicate label ${fingerprint.label}`);
    }
    if (
      !REQUIRED_FINGERPRINT_LABELS.includes(fingerprint.label) &&
      fingerprint.label !== OPTIONAL_FINGERPRINT_LABEL
    ) {
      throw new Error(`${label} contains unsupported label ${fingerprint.label}`);
    }
    byLabel.set(fingerprint.label, fingerprint);
  }
  for (const required of REQUIRED_FINGERPRINT_LABELS) {
    if (!byLabel.has(required)) {
      throw new Error(`${label} is missing required root ${required}`);
    }
  }
  return [
    ...REQUIRED_FINGERPRINT_LABELS,
    ...(byLabel.has(OPTIONAL_FINGERPRINT_LABEL)
      ? [OPTIONAL_FINGERPRINT_LABEL]
      : [])
  ].map((fingerprintLabel) => byLabel.get(fingerprintLabel));
}

function canonicalMemory(input, label) {
  assertExactKeys(input, MEMORY_KEYS, label);
  const memory = {
    shellWorkingSetBytes: requireInteger(
      input.shellWorkingSetBytes,
      `${label}.shellWorkingSetBytes`,
      1
    ),
    sidecarProcessCount: requireInteger(
      input.sidecarProcessCount,
      `${label}.sidecarProcessCount`,
      1
    ),
    sidecarWorkingSetBytes: requireInteger(
      input.sidecarWorkingSetBytes,
      `${label}.sidecarWorkingSetBytes`,
      1
    )
  };
  assertEqual(memory.sidecarProcessCount, 1, `${label}.sidecarProcessCount`);
  return memory;
}

export function validateInstalledEvidenceDocument(input, contract) {
  const {
    identity,
    installerBytes,
    installerSha256,
    shellBuildId,
    sidecarBuildId
  } = contract;
  assertExactKeys(input, TOP_LEVEL_KEYS, "installed evidence");
  assertEqual(input.schemaVersion, 1, "Installed evidence schemaVersion");
  assertEqual(input.result, "passed", "Installed evidence result");
  assertEqual(
    input.evidenceBoundary,
    "developer-machine-installed-shell-and-isolated-packaged-sidecar",
    "Installed evidence boundary"
  );
  if (
    typeof input.testedAtUtc !== "string" ||
    !ISO_UTC.test(input.testedAtUtc) ||
    !Number.isFinite(Date.parse(input.testedAtUtc))
  ) {
    throw new Error("Installed evidence testedAtUtc must be an ISO UTC timestamp");
  }

  assertExactKeys(input.installer, INSTALLER_KEYS, "installed evidence installer");
  const installer = {
    path: requireString(input.installer.path, "installed evidence installer.path"),
    bytes: requireInteger(input.installer.bytes, "installed evidence installer.bytes", 1),
    sha256: requireHash(input.installer.sha256, "installed evidence installer.sha256"),
    peMachine: requireString(
      input.installer.peMachine,
      "installed evidence installer.peMachine"
    ),
    authenticodeStatus: requireString(
      input.installer.authenticodeStatus,
      "installed evidence installer.authenticodeStatus"
    ),
    manifestPath: requireString(
      input.installer.manifestPath,
      "installed evidence installer.manifestPath"
    )
  };
  assertEqual(installer.path, identity.installerFilename, "Installed evidence installer path");
  assertEqual(installer.bytes, installerBytes, "Installed evidence installer bytes");
  assertEqual(installer.sha256, installerSha256, "Installed evidence installer SHA-256");
  assertEqual(installer.peMachine, "I386", "Installed evidence installer PE machine");
  assertEqual(
    installer.authenticodeStatus,
    "NotSigned",
    "Installed evidence installer Authenticode"
  );
  assertEqual(
    installer.manifestPath,
    "release-manifest.json",
    "Installed evidence manifest path"
  );

  assertExactKeys(input.upgrade, UPGRADE_KEYS, "installed evidence upgrade");
  assertExactKeys(
    input.upgrade.predecessorInstaller,
    PREDECESSOR_INSTALLER_KEYS,
    "installed evidence predecessor installer"
  );
  assertExactKeys(
    input.upgrade.predecessorInstallation,
    PREDECESSOR_INSTALLATION_KEYS,
    "installed evidence predecessor installation"
  );
  assertExactKeys(
    input.upgrade.preUpgradeBackup,
    PRE_UPGRADE_BACKUP_KEYS,
    "installed evidence pre-upgrade backup"
  );
  const expectedExecutablePath =
    `${identity.windowsPathContracts.install}\\${identity.executableName}`;
  const expectedUninstallerPath =
    `${identity.windowsPathContracts.install}\\uninstall.exe`;
  const predecessorInstaller = {
    path: requireString(
      input.upgrade.predecessorInstaller.path,
      "installed evidence predecessor installer.path"
    ),
    bytes: requireInteger(
      input.upgrade.predecessorInstaller.bytes,
      "installed evidence predecessor installer.bytes",
      1
    ),
    sha256: requireHash(
      input.upgrade.predecessorInstaller.sha256,
      "installed evidence predecessor installer.sha256"
    ),
    version: requireString(
      input.upgrade.predecessorInstaller.version,
      "installed evidence predecessor installer.version"
    ),
    peMachine: requireString(
      input.upgrade.predecessorInstaller.peMachine,
      "installed evidence predecessor installer.peMachine"
    ),
    authenticodeStatus: requireString(
      input.upgrade.predecessorInstaller.authenticodeStatus,
      "installed evidence predecessor installer.authenticodeStatus"
    )
  };
  const predecessorInstallation = {
    executablePath: requireString(
      input.upgrade.predecessorInstallation.executablePath,
      "installed evidence predecessor installation.executablePath"
    ),
    executableBytes: requireInteger(
      input.upgrade.predecessorInstallation.executableBytes,
      "installed evidence predecessor installation.executableBytes",
      1
    ),
    executableSha256: requireHash(
      input.upgrade.predecessorInstallation.executableSha256,
      "installed evidence predecessor installation.executableSha256"
    ),
    version: requireString(
      input.upgrade.predecessorInstallation.version,
      "installed evidence predecessor installation.version"
    ),
    executableAuthenticodeStatus: requireString(
      input.upgrade.predecessorInstallation.executableAuthenticodeStatus,
      "installed evidence predecessor installation.executableAuthenticodeStatus"
    )
  };
  const preUpgradeBackup = {
    root: requirePortableRelativePath(
      input.upgrade.preUpgradeBackup.root,
      "installed evidence pre-upgrade backup.root"
    ),
    manifestPath: requirePortableRelativePath(
      input.upgrade.preUpgradeBackup.manifestPath,
      "installed evidence pre-upgrade backup.manifestPath"
    ),
    manifestBytes: requireInteger(
      input.upgrade.preUpgradeBackup.manifestBytes,
      "installed evidence pre-upgrade backup.manifestBytes",
      1
    ),
    manifestSha256: requireHash(
      input.upgrade.preUpgradeBackup.manifestSha256,
      "installed evidence pre-upgrade backup.manifestSha256"
    ),
    fileCount: requireInteger(
      input.upgrade.preUpgradeBackup.fileCount,
      "installed evidence pre-upgrade backup.fileCount"
    ),
    bytes: requireInteger(
      input.upgrade.preUpgradeBackup.bytes,
      "installed evidence pre-upgrade backup.bytes"
    ),
    sourceFingerprintDigest: requireHash(
      input.upgrade.preUpgradeBackup.sourceFingerprintDigest,
      "installed evidence pre-upgrade backup.sourceFingerprintDigest"
    ),
    backupFingerprintDigest: requireHash(
      input.upgrade.preUpgradeBackup.backupFingerprintDigest,
      "installed evidence pre-upgrade backup.backupFingerprintDigest"
    )
  };
  if (
    !/^artifacts\/review\/pre-upgrade-user-data-backup-\d{8}T\d{9}Z(?:-\d+)?$/u.test(
      preUpgradeBackup.root
    )
  ) {
    throw new Error("Installed pre-upgrade backup root is not canonical");
  }
  assertEqual(
    preUpgradeBackup.manifestPath,
    `${preUpgradeBackup.root}/manifest.json`,
    "Installed pre-upgrade backup manifest path"
  );
  assertEqual(
    preUpgradeBackup.backupFingerprintDigest,
    preUpgradeBackup.sourceFingerprintDigest,
    "Installed pre-upgrade backup digest"
  );
  for (const [actual, expected, label] of [
    [
      input.upgrade.previousVersion,
      identity.upgradeFromVersion,
      "Installed evidence previous version"
    ],
    [
      input.upgrade.installedVersion,
      identity.version,
      "Installed evidence installed version"
    ],
    [
      predecessorInstaller.path,
      identity.upgradeFrom.installerFilename,
      "Predecessor installer path"
    ],
    [
      predecessorInstaller.bytes,
      identity.upgradeFrom.installerBytes,
      "Predecessor installer bytes"
    ],
    [
      predecessorInstaller.sha256,
      identity.upgradeFrom.installerSha256,
      "Predecessor installer SHA-256"
    ],
    [
      predecessorInstaller.version,
      identity.upgradeFrom.version,
      "Predecessor installer version"
    ],
    [predecessorInstaller.peMachine, "I386", "Predecessor installer PE machine"],
    [
      predecessorInstaller.authenticodeStatus,
      "NotSigned",
      "Predecessor installer Authenticode"
    ],
    [
      predecessorInstallation.executablePath,
      expectedExecutablePath,
      "Installed predecessor executable path"
    ],
    [
      predecessorInstallation.executableBytes,
      identity.upgradeFrom.installedExecutableBytes,
      "Installed predecessor executable bytes"
    ],
    [
      predecessorInstallation.executableSha256,
      identity.upgradeFrom.installedExecutableSha256,
      "Installed predecessor executable SHA-256"
    ],
    [
      predecessorInstallation.version,
      identity.upgradeFrom.version,
      "Installed predecessor executable version"
    ],
    [
      predecessorInstallation.executableAuthenticodeStatus,
      "NotSigned",
      "Installed predecessor executable Authenticode"
    ]
  ]) {
    assertEqual(actual, expected, label);
  }
  assertEqual(
    input.upgrade.userDataPreservedByInstaller,
    true,
    "Installer user-data preservation"
  );
  const fingerprintsBefore = canonicalFingerprints(
    input.upgrade.userDataFingerprintsBefore,
    "installed evidence fingerprints before"
  );
  const fingerprintsAfter = canonicalFingerprints(
    input.upgrade.userDataFingerprintsAfter,
    "installed evidence fingerprints after"
  );
  assertEqual(
    preUpgradeBackup.fileCount,
    fingerprintsBefore.reduce((total, entry) => total + entry.fileCount, 0),
    "Installed pre-upgrade backup file count"
  );
  assertEqual(
    preUpgradeBackup.bytes,
    fingerprintsBefore.reduce((total, entry) => total + entry.bytes, 0),
    "Installed pre-upgrade backup bytes"
  );
  assertEqual(
    stableJson(fingerprintsAfter),
    stableJson(fingerprintsBefore),
    "Pre/post-install user-data fingerprints"
  );

  assertExactKeys(input.identity, IDENTITY_KEYS, "installed evidence identity");
  const installedIdentity = {
    product: requireString(input.identity.product, "installed evidence identity.product"),
    version: requireString(input.identity.version, "installed evidence identity.version"),
    schemaVersion: requireInteger(
      input.identity.schemaVersion,
      "installed evidence identity.schemaVersion",
      1
    ),
    protocolVersion: requireInteger(
      input.identity.protocolVersion,
      "installed evidence identity.protocolVersion",
      1
    ),
    shellBuildId: requireString(
      input.identity.shellBuildId,
      "installed evidence identity.shellBuildId"
    ),
    sidecarBuildId: requireString(
      input.identity.sidecarBuildId,
      "installed evidence identity.sidecarBuildId"
    ),
    nodeVersion: requireString(
      input.identity.nodeVersion,
      "installed evidence identity.nodeVersion"
    ),
    nodeSha256: requireHash(
      input.identity.nodeSha256,
      "installed evidence identity.nodeSha256"
    )
  };
  for (const [actual, expected, label] of [
    [installedIdentity.product, identity.displayName, "Installed product"],
    [installedIdentity.version, identity.version, "Installed version"],
    [
      installedIdentity.schemaVersion,
      identity.projectSchemaVersion,
      "Installed schema version"
    ],
    [
      installedIdentity.protocolVersion,
      identity.localProtocolVersion,
      "Installed protocol version"
    ],
    [installedIdentity.shellBuildId, shellBuildId, "Installed shell build ID"],
    [installedIdentity.sidecarBuildId, sidecarBuildId, "Installed sidecar build ID"],
    [
      installedIdentity.nodeVersion,
      identity.nodeRuntime.version,
      "Installed Node version"
    ],
    [
      installedIdentity.nodeSha256,
      identity.nodeRuntime.sha256,
      "Installed Node SHA-256"
    ]
  ]) {
    assertEqual(actual, expected, label);
  }

  assertExactKeys(
    input.installation,
    INSTALLATION_KEYS,
    "installed evidence installation"
  );
  const installation = {
    executablePath: requireString(
      input.installation.executablePath,
      "installed evidence installation.executablePath"
    ),
    executableBytes: requireInteger(
      input.installation.executableBytes,
      "installed evidence installation.executableBytes",
      1
    ),
    executableSha256: requireHash(
      input.installation.executableSha256,
      "installed evidence installation.executableSha256"
    ),
    executableAuthenticodeStatus: requireString(
      input.installation.executableAuthenticodeStatus,
      "installed evidence installation.executableAuthenticodeStatus"
    ),
    installRoot: requireString(
      input.installation.installRoot,
      "installed evidence installation.installRoot"
    ),
    fileCount: requireInteger(
      input.installation.fileCount,
      "installed evidence installation.fileCount",
      1
    ),
    bytes: requireInteger(
      input.installation.bytes,
      "installed evidence installation.bytes",
      1
    ),
    uninstallerPath: requireString(
      input.installation.uninstallerPath,
      "installed evidence installation.uninstallerPath"
    ),
    uninstallerBytes: requireInteger(
      input.installation.uninstallerBytes,
      "installed evidence installation.uninstallerBytes",
      1
    ),
    uninstallerSha256: requireHash(
      input.installation.uninstallerSha256,
      "installed evidence installation.uninstallerSha256"
    ),
    uninstallerPeMachine: requireString(
      input.installation.uninstallerPeMachine,
      "installed evidence installation.uninstallerPeMachine"
    ),
    uninstallerAuthenticodeStatus: requireString(
      input.installation.uninstallerAuthenticodeStatus,
      "installed evidence installation.uninstallerAuthenticodeStatus"
    )
  };
  assertEqual(
    installation.executablePath,
    expectedExecutablePath,
    "Installed executable path"
  );
  assertEqual(
    installation.executableAuthenticodeStatus,
    "NotSigned",
    "Installed executable Authenticode"
  );
  assertEqual(
    installation.installRoot,
    identity.windowsPathContracts.install,
    "Installed root"
  );
  assertEqual(
    installation.uninstallerPath,
    expectedUninstallerPath,
    "Installed uninstaller path"
  );
  assertEqual(
    installation.uninstallerPeMachine,
    "I386",
    "Installed uninstaller PE machine"
  );
  assertEqual(
    installation.uninstallerAuthenticodeStatus,
    "NotSigned",
    "Installed uninstaller Authenticode"
  );

  assertExactKeys(input.runtime, RUNTIME_KEYS, "installed evidence runtime");
  const runtime = {
    firstDynamicPort: requireInteger(
      input.runtime.firstDynamicPort,
      "installed evidence runtime.firstDynamicPort",
      1
    ),
    secondDynamicPort: requireInteger(
      input.runtime.secondDynamicPort,
      "installed evidence runtime.secondDynamicPort",
      1
    ),
    coldReadyMilliseconds: requireInteger(
      input.runtime.coldReadyMilliseconds,
      "installed evidence runtime.coldReadyMilliseconds",
      1
    ),
    warmReadyMilliseconds: requireInteger(
      input.runtime.warmReadyMilliseconds,
      "installed evidence runtime.warmReadyMilliseconds",
      1
    ),
    coldRitualSurvivalMilliseconds: requireInteger(
      input.runtime.coldRitualSurvivalMilliseconds,
      "installed evidence runtime.coldRitualSurvivalMilliseconds",
      20_000
    ),
    warmRitualSurvivalMilliseconds: requireInteger(
      input.runtime.warmRitualSurvivalMilliseconds,
      "installed evidence runtime.warmRitualSurvivalMilliseconds",
      20_000
    ),
    coldMemory: canonicalMemory(
      input.runtime.coldMemory,
      "installed evidence runtime.coldMemory"
    ),
    warmMemory: canonicalMemory(
      input.runtime.warmMemory,
      "installed evidence runtime.warmMemory"
    ),
    startupRitualSeconds: requireInteger(
      input.runtime.startupRitualSeconds,
      "installed evidence runtime.startupRitualSeconds",
      1
    ),
    singleInstance: requireString(
      input.runtime.singleInstance,
      "installed evidence runtime.singleInstance"
    ),
    normalWindowCloseStopsSidecar: requireString(
      input.runtime.normalWindowCloseStopsSidecar,
      "installed evidence runtime.normalWindowCloseStopsSidecar"
    ),
    forcedTerminationDynamicPort: requireInteger(
      input.runtime.forcedTerminationDynamicPort,
      "installed evidence runtime.forcedTerminationDynamicPort",
      1
    ),
    forcedShellTerminationStopsSidecar: requireString(
      input.runtime.forcedShellTerminationStopsSidecar,
      "installed evidence runtime.forcedShellTerminationStopsSidecar"
    ),
    apiVerification: requireString(
      input.runtime.apiVerification,
      "installed evidence runtime.apiVerification"
    )
  };
  if (
    runtime.firstDynamicPort > 65_535 ||
    runtime.secondDynamicPort > 65_535 ||
    runtime.forcedTerminationDynamicPort > 65_535
  ) {
    throw new Error("Installed evidence runtime ports must be valid TCP ports");
  }
  assertEqual(runtime.startupRitualSeconds, 20, "Startup ritual seconds");
  assertEqual(runtime.singleInstance, "passed", "Single-instance result");
  assertEqual(
    runtime.normalWindowCloseStopsSidecar,
    "passed",
    "Sidecar close result"
  );
  assertEqual(
    runtime.forcedShellTerminationStopsSidecar,
    "passed",
    "Forced shell termination sidecar result"
  );
  assertEqual(
    runtime.apiVerification,
    "delegated-to-isolated-packaged-sidecar-gate",
    "Installed API verification boundary"
  );

  return {
    schemaVersion: 1,
    result: "passed",
    testedAtUtc: input.testedAtUtc,
    evidenceBoundary: input.evidenceBoundary,
    installer,
    upgrade: {
      previousVersion: input.upgrade.previousVersion,
      installedVersion: input.upgrade.installedVersion,
      predecessorInstaller,
      predecessorInstallation,
      preUpgradeBackup,
      userDataPreservedByInstaller: true,
      userDataFingerprintsBefore: fingerprintsBefore,
      userDataFingerprintsAfter: fingerprintsAfter
    },
    identity: installedIdentity,
    installation,
    runtime
  };
}

function formatMib(bytes) {
  return (Number(bytes) / (1024 * 1024)).toFixed(1);
}

export function createInstalledEvidenceBundle(input, contract) {
  const evidence = validateInstalledEvidenceDocument(input, contract);
  const evidenceSource = stableJson(evidence);
  const evidenceHash = sha256(Buffer.from(evidenceSource, "utf8"));
  const { identity } = contract;
  const smoke = `# Packaged app smoke test - ${identity.displayName} ${identity.version}

Status: PASSED

- Release: ${identity.version}
- Installer SHA-256: ${contract.installerSha256}
- Tested at: ${evidence.testedAtUtc}
- Installed evidence: ${INSTALLED_EVIDENCE_FILENAME}
- Installed evidence SHA-256: ${evidenceHash}
- Boundary: developer-machine installed shell; this is not clean-machine or visual-workflow evidence.
- Installed executable: AMD64, ${evidence.installation.executableAuthenticodeStatus}, ${evidence.installation.executableBytes} bytes, SHA-256 ${evidence.installation.executableSha256}
- Installed uninstaller: ${evidence.installation.uninstallerPeMachine}, ${evidence.installation.uninstallerAuthenticodeStatus}, ${evidence.installation.uninstallerBytes} bytes, SHA-256 ${evidence.installation.uninstallerSha256}
- Installed footprint: ${evidence.installation.bytes} bytes (${formatMib(evidence.installation.bytes)} MiB), ${evidence.installation.fileCount} files
- Cold/warm sidecar readiness: ${evidence.runtime.coldReadyMilliseconds} ms / ${evidence.runtime.warmReadyMilliseconds} ms
- Forced shell termination sidecar port: ${evidence.runtime.forcedTerminationDynamicPort}
- Cold/warm 20-second ritual survival: ${evidence.runtime.coldRitualSurvivalMilliseconds} ms / ${evidence.runtime.warmRitualSurvivalMilliseconds} ms
- Cold shell/sidecar working set: ${formatMib(evidence.runtime.coldMemory.shellWorkingSetBytes)} MiB / ${formatMib(evidence.runtime.coldMemory.sidecarWorkingSetBytes)} MiB
- Warm shell/sidecar working set: ${formatMib(evidence.runtime.warmMemory.shellWorkingSetBytes)} MiB / ${formatMib(evidence.runtime.warmMemory.sidecarWorkingSetBytes)} MiB
- Passed: native main window, dynamic IPv4 loopback ports, canonical runtime identity, two independent normal launches, one sidecar per launch, single-instance enforcement, normal-window-close sidecar shutdown, forced-shell-termination sidecar shutdown, and no protocol-secret trace in current sidecar logs.
- API and persistence boundary: the installed-shell verifier records delegation to the separately executed isolated packaged-sidecar gate; this JSON does not substitute for that gate's own evidence.
`;

  const fingerprints = evidence.upgrade.userDataFingerprintsBefore
    .map((before, index) => {
      const after = evidence.upgrade.userDataFingerprintsAfter[index];
      return `  - ${before.label}: before=${before.digest}; after=${after.digest}; files=${before.fileCount}; bytes=${before.bytes}`;
    })
    .join("\n");
  const upgrade = `# Upgrade test - ${identity.displayName} ${identity.version}

Status: PASSED

- Release: ${identity.version}
- Installer SHA-256: ${contract.installerSha256}
- Tested at: ${evidence.testedAtUtc}
- Installed evidence: ${INSTALLED_EVIDENCE_FILENAME}
- Installed evidence SHA-256: ${evidenceHash}
- Upgrade: ${evidence.upgrade.previousVersion} -> ${evidence.upgrade.installedVersion}
- Predecessor installer: ${evidence.upgrade.predecessorInstaller.path}; SHA-256 ${evidence.upgrade.predecessorInstaller.sha256}
- Installed predecessor executable SHA-256: ${evidence.upgrade.predecessorInstallation.executableSha256}
- Verified pre-upgrade backup: ${evidence.upgrade.preUpgradeBackup.root}; manifest SHA-256 ${evidence.upgrade.preUpgradeBackup.manifestSha256}
- Result: regular-file path, byte length, and SHA-256 inventories were identical before and immediately after silent installation.
- Boundary: normal application launch subsequently updates runtime logs and WebView2 cache by design; uninstall retention is recorded separately and this is not clean-machine evidence.
- Pre/post-install fingerprints:
${fingerprints}
`;
  return { evidence, evidenceHash, evidenceSource, smoke, upgrade };
}

export async function writeInstalledTestReports(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const identity = await readJson(resolve(root, "release/identity.json"));
  const releaseDirectory = resolve(root, identity.releaseDirectory);
  const manifest = await readJson(
    resolve(releaseDirectory, "release-manifest.json")
  );
  const evidencePath = resolve(
    root,
    options.evidencePath ?? "artifacts/review/installed-desktop-report.json"
  );
  const evidenceInput = await readJson(evidencePath);
  const installerPath = resolve(releaseDirectory, identity.installerFilename);
  const installerData = await readFile(installerPath);
  const installerHash = sha256(installerData);
  assertEqual(
    manifest.installer.sha256,
    installerHash,
    "Release manifest installer SHA-256"
  );
  assertEqual(
    manifest.installer.bytes,
    installerData.length,
    "Release manifest installer bytes"
  );
  const bundle = createInstalledEvidenceBundle(evidenceInput, {
    identity,
    installerBytes: installerData.length,
    installerSha256: installerHash,
    shellBuildId: manifest.shellBuildId,
    sidecarBuildId: manifest.sidecarBuildId
  });
  await Promise.all([
    writeFile(
      resolve(releaseDirectory, INSTALLED_EVIDENCE_FILENAME),
      bundle.evidenceSource,
      "utf8"
    ),
    writeFile(
      resolve(releaseDirectory, "smoke-test-report.md"),
      bundle.smoke,
      "utf8"
    ),
    writeFile(
      resolve(releaseDirectory, "upgrade-test-report.md"),
      bundle.upgrade,
      "utf8"
    )
  ]);
  return {
    evidenceHash: bundle.evidenceHash,
    releaseDirectory,
    installerHash
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" || argument === "--evidence") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a path`);
      }
      if (argument === "--root") {
        options.root = isAbsolute(value) ? value : resolve(value);
      } else {
        options.evidencePath = value;
      }
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

const invokedPath =
  process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await writeInstalledTestReports(
      parseArguments(process.argv.slice(2))
    );
    console.log(`Installed test reports written: ${result.releaseDirectory}`);
    console.log(`Installer SHA-256: ${result.installerHash}`);
    console.log(`Installed evidence SHA-256: ${result.evidenceHash}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
