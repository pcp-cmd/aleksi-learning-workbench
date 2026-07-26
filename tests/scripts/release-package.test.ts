import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type GenerateOptions = {
  buildDate: string;
  installerMetadata: {
    authenticodeStatus: string;
    fileDescription: string;
    fileVersion: string;
    peMachine: string;
    productName: string;
    productVersion: string;
  };
  minimumInstallerBytes: number;
  root: string;
  sourceState: {
    commit: string;
    dirty: boolean;
    dirtyFiles: string[];
    worktreeFingerprint: string;
    worktreeFingerprintScope: string;
  };
  toolVersions: {
    node: string;
    npm: string;
    rustc: string;
  };
};

type ReleaseArtifact = {
  bytes: number;
  path: string;
  sha256: string;
};

type ReleaseManifest = {
  architecture: string;
  artifacts: ReleaseArtifact[];
  buildDate: string;
  commit: string;
  installer: ReleaseArtifact | null;
  installerStatus: "present" | "absent";
  localProtocolVersion: number;
  product: string;
  projectSchemaVersion: number;
  signed: boolean;
  tauriVersion: string;
  version: string;
  webView2: {
    installMode: string;
    policy: string;
  };
};

type PackageReleaseModule = {
  generateReleaseEvidence: (
    options: GenerateOptions
  ) => Promise<{ manifest: ReleaseManifest; outputDirectory: string }>;
  inspectPeMachine: (data: Buffer) => string;
};

const temporaryDirectories: string[] = [];
let canonicalIdentity: Record<string, unknown> & {
  installerFilename: string;
  localProtocolVersion: number;
  nodeRuntime: {
    licensePath: string;
    sha256: string;
    version: string;
  };
  releaseDirectory: string;
  upgradeFrom: {
    installedExecutableBytes: number;
    installedExecutableSha256: string;
    installerBytes: number;
    installerFilename: string;
    installerSha256: string;
  };
  upgradeFromVersion: string;
  version: string;
};
let releasePackager: PackageReleaseModule;

async function writeFixtureFile(
  root: string,
  path: string,
  content: string | Uint8Array
): Promise<void> {
  const target = join(root, ...path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function makeFixture(withInstaller = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aleksi-release-evidence-"));
  temporaryDirectories.push(root);
  await writeFixtureFile(
    root,
    "release/identity.json",
    `${JSON.stringify(canonicalIdentity, null, 2)}\n`
  );
  await writeFixtureFile(
    root,
    canonicalIdentity.nodeRuntime.licensePath,
    await readFile(
      join(process.cwd(), ...canonicalIdentity.nodeRuntime.licensePath.split("/"))
    )
  );
  await writeFixtureFile(
    root,
    "package.json",
    `${JSON.stringify({ name: "aleksi-learning-workbench", version: "0.1.3" })}\n`
  );
  await writeFixtureFile(
    root,
    "package-lock.json",
    `${JSON.stringify(
      {
        name: "aleksi-learning-workbench",
        version: "0.1.3",
        lockfileVersion: 3,
        packages: {
          "": { name: "aleksi-learning-workbench", version: "0.1.3" },
          "node_modules/react": {
            version: "19.1.0",
            license: "MIT",
            resolved: "https://registry.npmjs.org/react/-/react-19.1.0.tgz",
            integrity: "sha512-fixture"
          }
        }
      },
      null,
      2
    )}\n`
  );
  await writeFixtureFile(
    root,
    "src-tauri/Cargo.toml",
    '[package]\nname = "aleksi-workbench"\nversion = "0.1.3"\n'
  );
  await writeFixtureFile(
    root,
    "src-tauri/Cargo.lock",
    `version = 3

[[package]]
name = "aleksi-workbench"
version = "0.1.3"

[[package]]
name = "tauri"
version = "2.9.5"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
`
  );
  await writeFixtureFile(
    root,
    "src-tauri/tauri.conf.json",
    `${JSON.stringify({
      productName: "Aleksi Workbench",
      version: "0.1.3",
      identifier: "io.aleksi.workbench",
      app: { windows: [{ title: "Aleksi Workbench" }] },
      bundle: {
        publisher: "Aleksi",
        longDescription:
          "Aleksi Workbench is a local-first desktop learning workspace backed by a Markdown Local Learning Library.",
        windows: {
          nsis: { installMode: "currentUser" },
          webviewInstallMode: { type: "downloadBootstrapper" }
        }
      }
    })}\n`
  );
  await writeFixtureFile(
    root,
    "src-tauri/resources/identity.json",
    `${JSON.stringify({
      schemaVersion: 2,
      product: "Aleksi Workbench",
      version: "0.1.3",
      protocolVersion: 1,
      buildId: "desktop-aaaaaaaaaaaaaaaaaaaa",
      shellBuildId: "desktop-aaaaaaaaaaaaaaaaaaaa",
      sidecarBuildId: "sidecar-bbbbbbbbbbbbbbbbbbbb",
      nodeVersion: canonicalIdentity.nodeRuntime.version,
      files: [
        {
          path: "sidecar/node.exe",
          bytes: 86_989_128,
          sha256: canonicalIdentity.nodeRuntime.sha256
        }
      ]
    })}\n`
  );
  await writeFixtureFile(
    root,
    "scripts/prepare-desktop.mjs",
    `
      const canonicalReleaseIdentityPath = "release/identity.json";
      const releaseIdentity = JSON.parse(source);
      const identity = {
        schemaVersion: releaseIdentity.projectSchemaVersion,
        product: releaseIdentity.displayName,
        version: releaseIdentity.version,
        protocolVersion: releaseIdentity.localProtocolVersion,
        nodeVersion: releaseIdentity.nodeRuntime.version
      };
    `
  );
  await writeFixtureFile(
    root,
    "scripts/desktop-package-rules.mjs",
    `
      const canonicalReleaseIdentityPath = "release/identity.json";
      const releaseIdentity = JSON.parse(source);
      export const DESKTOP_INSTALLER_PATH =
        releaseIdentity.releaseDirectory + "/" + releaseIdentity.installerFilename;
    `
  );

  if (withInstaller) {
    const installer = Buffer.alloc(64, 0x5a);
    installer[0] = 0x4d;
    installer[1] = 0x5a;
    await writeFixtureFile(
      root,
      `${canonicalIdentity.releaseDirectory}/${canonicalIdentity.installerFilename}`,
      installer
    );
  }
  return root;
}

function options(root: string): GenerateOptions {
  return {
    root,
    buildDate: "2026-07-22T11:36:35.000Z",
    installerMetadata: {
      authenticodeStatus: "NotSigned",
      fileDescription: "Aleksi Workbench",
      fileVersion: "0.1.3",
      peMachine: "I386",
      productName: "Aleksi Workbench",
      productVersion: "0.1.3"
    },
    minimumInstallerBytes: 2,
    sourceState: {
      commit: "0123456789abcdef0123456789abcdef01234567",
      dirty: false,
      dirtyFiles: [],
      worktreeFingerprint: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      worktreeFingerprintScope: "test-fixture"
    },
    toolVersions: {
      node: "v22.14.0",
      npm: "10.9.2",
      rustc: "rustc 1.88.0"
    }
  };
}

function installedEvidenceFixture(
  installerBytes: number,
  installerHash: string
) {
  const fingerprints = [
    {
      label: "%APPDATA%\\Aleksi Learning Workbench",
      exists: false,
      fileCount: 0,
      bytes: 0,
      digest: "1".repeat(64)
    },
    {
      label: "%APPDATA%\\io.aleksi.workbench",
      exists: true,
      fileCount: 1,
      bytes: 11,
      digest: "2".repeat(64)
    },
    {
      label: "%LOCALAPPDATA%\\io.aleksi.workbench",
      exists: true,
      fileCount: 2,
      bytes: 22,
      digest: "3".repeat(64)
    },
    {
      label: "%USERPROFILE%\\Documents\\Aleksi Learning Workbench",
      exists: true,
      fileCount: 3,
      bytes: 33,
      digest: "4".repeat(64)
    }
  ];
  return {
    schemaVersion: 1,
    result: "passed",
    testedAtUtc: "2026-07-22T12:00:00.000Z",
    evidenceBoundary:
      "developer-machine-installed-shell-and-isolated-packaged-sidecar",
    installer: {
      path: canonicalIdentity.installerFilename,
      bytes: installerBytes,
      sha256: installerHash,
      peMachine: "I386",
      authenticodeStatus: "NotSigned",
      manifestPath: "release-manifest.json"
    },
    upgrade: {
      previousVersion: canonicalIdentity.upgradeFromVersion,
      installedVersion: canonicalIdentity.version,
      predecessorInstaller: {
        path: canonicalIdentity.upgradeFrom.installerFilename,
        bytes: canonicalIdentity.upgradeFrom.installerBytes,
        sha256: canonicalIdentity.upgradeFrom.installerSha256,
        version: canonicalIdentity.upgradeFromVersion,
        peMachine: "I386",
        authenticodeStatus: "NotSigned"
      },
      predecessorInstallation: {
        executablePath:
          "%LOCALAPPDATA%\\Aleksi Workbench\\aleksi-workbench.exe",
        executableBytes:
          canonicalIdentity.upgradeFrom.installedExecutableBytes,
        executableSha256:
          canonicalIdentity.upgradeFrom.installedExecutableSha256,
        version: canonicalIdentity.upgradeFromVersion,
        executableAuthenticodeStatus: "NotSigned"
      },
      preUpgradeBackup: {
        root:
          "artifacts/review/pre-upgrade-user-data-backup-20260722T120000000Z",
        manifestPath:
          "artifacts/review/pre-upgrade-user-data-backup-20260722T120000000Z/manifest.json",
        manifestBytes: 4_096,
        manifestSha256: "2".repeat(64),
        fileCount: 6,
        bytes: 66,
        sourceFingerprintDigest: "3".repeat(64),
        backupFingerprintDigest: "3".repeat(64)
      },
      userDataPreservedByInstaller: true,
      userDataFingerprintsBefore: fingerprints,
      userDataFingerprintsAfter: structuredClone(fingerprints)
    },
    identity: {
      product: "Aleksi Workbench",
      version: canonicalIdentity.version,
      schemaVersion: 2,
      protocolVersion: canonicalIdentity.localProtocolVersion,
      shellBuildId: "desktop-aaaaaaaaaaaaaaaaaaaa",
      sidecarBuildId: "sidecar-bbbbbbbbbbbbbbbbbbbb",
      nodeVersion: canonicalIdentity.nodeRuntime.version,
      nodeSha256: canonicalIdentity.nodeRuntime.sha256
    },
    installation: {
      executablePath:
        "%LOCALAPPDATA%\\Aleksi Workbench\\aleksi-workbench.exe",
      executableBytes: 10_500_000,
      executableSha256: "5".repeat(64),
      executableAuthenticodeStatus: "NotSigned",
      installRoot: "%LOCALAPPDATA%\\Aleksi Workbench",
      uninstallerPath:
        "%LOCALAPPDATA%\\Aleksi Workbench\\uninstall.exe",
      uninstallerBytes: 3_000_000,
      uninstallerSha256: "7".repeat(64),
      uninstallerPeMachine: "I386",
      uninstallerAuthenticodeStatus: "NotSigned",
      fileCount: 7,
      bytes: 100_000_000
    },
    runtime: {
      firstDynamicPort: 41001,
      secondDynamicPort: 41002,
      coldReadyMilliseconds: 800,
      warmReadyMilliseconds: 600,
      coldRitualSurvivalMilliseconds: 23_000,
      warmRitualSurvivalMilliseconds: 23_000,
      coldMemory: {
        shellWorkingSetBytes: 10_000_000,
        sidecarProcessCount: 1,
        sidecarWorkingSetBytes: 20_000_000
      },
      warmMemory: {
        shellWorkingSetBytes: 11_000_000,
        sidecarProcessCount: 1,
        sidecarWorkingSetBytes: 21_000_000
      },
      startupRitualSeconds: 20,
      singleInstance: "passed",
      normalWindowCloseStopsSidecar: "passed",
      forcedTerminationDynamicPort: 41003,
      forcedShellTerminationStopsSidecar: "passed",
      apiVerification: "delegated-to-isolated-packaged-sidecar-gate"
    }
  };
}

function lifecycleEvidenceFixture(
  installerBytes: number,
  installerHash: string,
  installedEvidenceSource: string,
  installedEvidence: ReturnType<typeof installedEvidenceFixture>,
  runtimeIdentitySource: string
) {
  const fingerprints = structuredClone(
    installedEvidence.upgrade.userDataFingerprintsAfter
  );
  const installedEvidenceHash = createHash("sha256")
    .update(installedEvidenceSource)
    .digest("hex");
  const runtimeIdentityHash = createHash("sha256")
    .update(runtimeIdentitySource)
    .digest("hex");
  const fingerprintDigest = createHash("sha256")
    .update(
      fingerprints
        .map((entry) =>
          [
            entry.label,
            String(entry.exists),
            String(entry.fileCount),
            String(entry.bytes),
            entry.digest
          ].join("\t")
        )
        .join("\n")
    )
    .digest("hex");
  return {
    schemaVersion: 1,
    result: "passed",
    testedAtUtc: "2026-07-22T13:00:00.000Z",
    evidenceBoundary:
      "developer-machine-uninstall-retention-and-same-installer-reinstall",
    installer: {
      path: canonicalIdentity.installerFilename,
      bytes: installerBytes,
      sha256: installerHash
    },
    installedEvidence: {
      path: "installed-desktop-evidence.json",
      bytes: Buffer.byteLength(installedEvidenceSource),
      sha256: installedEvidenceHash,
      testedAtUtc: installedEvidence.testedAtUtc
    },
    identity: {
      version: canonicalIdentity.version,
      protocolVersion: canonicalIdentity.localProtocolVersion,
      shellBuildId: "desktop-aaaaaaaaaaaaaaaaaaaa",
      sidecarBuildId: "sidecar-bbbbbbbbbbbbbbbbbbbb",
      nodeVersion: canonicalIdentity.nodeRuntime.version,
      nodeSha256: canonicalIdentity.nodeRuntime.sha256,
      runtimeIdentityBytes: Buffer.byteLength(runtimeIdentitySource),
      runtimeIdentitySha256: runtimeIdentityHash
    },
    installation: {
      installRoot: "%LOCALAPPDATA%\\Aleksi Workbench",
      executablePath:
        "%LOCALAPPDATA%\\Aleksi Workbench\\aleksi-workbench.exe",
      executableBytesBefore:
        installedEvidence.installation.executableBytes,
      executableSha256Before:
        installedEvidence.installation.executableSha256,
      executableBytesAfter:
        installedEvidence.installation.executableBytes,
      executableSha256After:
        installedEvidence.installation.executableSha256
    },
    backup: {
      root:
        "artifacts/review/pre-uninstall-user-data-backup-20260722T130000000Z",
      manifestPath:
        "artifacts/review/pre-uninstall-user-data-backup-20260722T130000000Z/manifest.json",
      manifestBytes: 4_096,
      manifestSha256: "6".repeat(64),
      fileCount: 6,
      bytes: 66,
      sourceFingerprintDigest: fingerprintDigest,
      backupFingerprintDigest: fingerprintDigest
    },
    userDataFingerprintsBefore: fingerprints,
    userDataFingerprintsAfterUninstall: structuredClone(fingerprints),
    userDataFingerprintsAfterReinstall: structuredClone(fingerprints),
    uninstall: {
      exitCode: 0,
      installDirectoryRemoved: true,
      registryKeyRemoved: true
    },
    reinstall: {
      exitCode: 0,
      registryVersion: canonicalIdentity.version
    },
    runtime: {
      dynamicPort: 41_003,
      oneSidecarProcess: true,
      normalWindowCloseStopsSidecar: true
    },
    recovery: {
      attempted: false,
      installerExitCode: null,
      applicationRestored: true
    }
  };
}

async function materializeLifecycleBackup(
  root: string,
  evidence: ReturnType<typeof lifecycleEvidenceFixture>
): Promise<void> {
  const backupRoot = join(root, ...evidence.backup.root.split("/"));
  await rm(backupRoot, { force: true, recursive: true });
  const manifestRoots = [];
  for (
    let rootIndex = 0;
    rootIndex < evidence.userDataFingerprintsBefore.length;
    rootIndex += 1
  ) {
    const fingerprint = evidence.userDataFingerprintsBefore[rootIndex];
    const directory = `data/root-${String(rootIndex).padStart(2, "0")}`;
    const files = [];
    if (fingerprint.exists) {
      await mkdir(
        join(root, ...`${evidence.backup.root}/${directory}`.split("/")),
        { recursive: true }
      );
    }
    let remainingBytes = fingerprint.bytes;
    for (
      let fileIndex = 0;
      fileIndex < fingerprint.fileCount;
      fileIndex += 1
    ) {
      const remainingFiles = fingerprint.fileCount - fileIndex;
      const bytes =
        fileIndex === fingerprint.fileCount - 1
          ? remainingBytes
          : Math.floor(remainingBytes / remainingFiles);
      remainingBytes -= bytes;
      const path = `file-${String(fileIndex).padStart(2, "0")}.bin`;
      const data = Buffer.alloc(
        bytes,
        65 + ((rootIndex + fileIndex) % 26)
      );
      await writeFixtureFile(root, `${evidence.backup.root}/${directory}/${path}`, data);
      files.push({
        path,
        bytes,
        sha256: createHash("sha256").update(data).digest("hex")
      });
    }
    const inventoryPayload =
      files.length === 0
        ? ""
        : JSON.stringify(files.length === 1 ? files[0] : files);
    const digest = createHash("sha256")
      .update(inventoryPayload)
      .digest("hex");
    for (const fingerprints of [
      evidence.userDataFingerprintsBefore,
      evidence.userDataFingerprintsAfterUninstall,
      evidence.userDataFingerprintsAfterReinstall
    ].filter(Array.isArray)) {
      fingerprints[rootIndex].digest = digest;
    }
    manifestRoots.push({
      label: fingerprint.label,
      exists: fingerprint.exists,
      directory,
      files
    });
  }
  const fingerprintDigest = createHash("sha256")
    .update(
      evidence.userDataFingerprintsBefore
        .map((entry) =>
          [
            entry.label,
            String(entry.exists),
            String(entry.fileCount),
            String(entry.bytes),
            entry.digest
          ].join("\t")
        )
        .join("\n")
    )
    .digest("hex");
  evidence.backup.sourceFingerprintDigest = fingerprintDigest;
  evidence.backup.backupFingerprintDigest = fingerprintDigest;
  const manifest = {
    schemaVersion: 1,
    createdAtUtc: new Date(
      Date.parse(evidence.testedAtUtc) - 60_000
    ).toISOString(),
    inventorySemantics:
      "regular-file-relative-path-byte-length-sha256",
    roots: manifestRoots,
    summary: {
      fileCount: evidence.backup.fileCount,
      bytes: evidence.backup.bytes,
      sourceFingerprintDigest: fingerprintDigest,
      backupFingerprintDigest: fingerprintDigest
    }
  };
  const source = `${JSON.stringify(manifest, null, 2)}\n`;
  evidence.backup.manifestBytes = Buffer.byteLength(source);
  evidence.backup.manifestSha256 = createHash("sha256")
    .update(source)
    .digest("hex");
  await writeFixtureFile(root, evidence.backup.manifestPath, source);
}

async function materializeInstalledBackup(
  root: string,
  evidence: ReturnType<typeof installedEvidenceFixture>
): Promise<void> {
  await materializeLifecycleBackup(root, {
    backup: evidence.upgrade.preUpgradeBackup,
    testedAtUtc: evidence.testedAtUtc,
    userDataFingerprintsBefore:
      evidence.upgrade.userDataFingerprintsBefore,
    userDataFingerprintsAfterUninstall:
      evidence.upgrade.userDataFingerprintsAfter,
    userDataFingerprintsAfterReinstall:
      evidence.upgrade.userDataFingerprintsAfter
  } as ReturnType<typeof lifecycleEvidenceFixture>);
}

beforeAll(async () => {
  const root = process.cwd();
  canonicalIdentity = JSON.parse(
    await readFile(join(root, "release/identity.json"), "utf8")
  ) as typeof canonicalIdentity;
  releasePackager = (await import(
    pathToFileURL(join(root, "scripts/package-release.mjs")).href
  )) as PackageReleaseModule;
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe("release evidence package", () => {
  it("identifies structurally valid NSIS I386 and payload AMD64 PE headers", () => {
    const executable = Buffer.alloc(256);
    executable.writeUInt16LE(0x5a4d, 0);
    executable.writeUInt32LE(0x80, 0x3c);
    executable.writeUInt32LE(0x0000_4550, 0x80);
    executable.writeUInt16LE(0x8664, 0x84);

    expect(releasePackager.inspectPeMachine(executable)).toBe("AMD64");
    executable.writeUInt16LE(0x014c, 0x84);
    expect(releasePackager.inspectPeMachine(executable)).toBe("I386");
    executable.writeUInt16LE(0xaa64, 0x84);
    expect(() => releasePackager.inspectPeMachine(executable)).toThrow(
      /unsupported/u
    );
  });

  it("writes a deterministic, hashed evidence tree around an existing installer", async () => {
    const root = await makeFixture();
    const first = await releasePackager.generateReleaseEvidence(options(root));
    const managedPaths = [
      "build-provenance.json",
      "known-limitations.md",
      "licenses/NODEJS-LICENSE-v22.23.1.txt",
      "licenses/README.md",
      "licenses/dependency-licenses.json",
      "release-manifest.json",
      "SBOM.spdx.json",
      "smoke-test-report.md",
      "upgrade-test-report.md",
      `${canonicalIdentity.installerFilename}.sha256`
    ];
    const firstBytes = await Promise.all(
      managedPaths.map((path) => readFile(join(first.outputDirectory, path), "utf8"))
    );

    const second = await releasePackager.generateReleaseEvidence(options(root));
    const secondBytes = await Promise.all(
      managedPaths.map((path) => readFile(join(second.outputDirectory, path), "utf8"))
    );
    expect(secondBytes).toEqual(firstBytes);

    const manifest = second.manifest;
    expect(manifest).toMatchObject({
      product: "Aleksi Workbench",
      version: "0.1.3",
      commit: "0123456789abcdef0123456789abcdef01234567",
      architecture: process.arch,
      buildDate: "2026-07-22T11:36:35.000Z",
      tauriVersion: "2.9.5",
      projectSchemaVersion: 2,
      localProtocolVersion: 1,
      upgradeFromVersion: "0.1.2",
      upgradeFrom: canonicalIdentity.upgradeFrom,
      signed: false,
      installerStatus: "present",
      installer: {
        authenticodeStatus: "NotSigned",
        peMachine: "I386"
      },
      webView2: {
        policy: "online-light",
        installMode: "downloadBootstrapper"
      }
    });
    expect(manifest.installer?.path).toBe(canonicalIdentity.installerFilename);
    const installer = await readFile(
      join(first.outputDirectory, canonicalIdentity.installerFilename)
    );
    expect(manifest.installer?.sha256).toBe(
      createHash("sha256").update(installer).digest("hex")
    );
    expect(manifest.artifacts.map((artifact) => artifact.path)).toEqual(
      [...manifest.artifacts.map((artifact) => artifact.path)].sort()
    );
    for (const artifact of manifest.artifacts) {
      const data = await readFile(join(first.outputDirectory, artifact.path));
      expect(artifact.bytes).toBe(data.length);
      expect(artifact.sha256).toBe(
        createHash("sha256").update(data).digest("hex")
      );
    }
    await expect(
      readFile(
        join(
          first.outputDirectory,
          `${canonicalIdentity.installerFilename}.sha256`
        ),
        "utf8"
      )
    ).resolves.toBe(
      `${manifest.installer?.sha256}  ${canonicalIdentity.installerFilename}\n`
    );

    const sbom = JSON.parse(
      await readFile(join(first.outputDirectory, "SBOM.spdx.json"), "utf8")
    ) as { packages: Array<{ name: string }> };
    expect(sbom.packages.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["Aleksi Workbench", "Node.js", "react", "tauri"])
    );
  });

  it("rejects a managed release junction before recursive cleanup", async () => {
    const root = await makeFixture();
    const first = await releasePackager.generateReleaseEvidence(options(root));
    const licensesDirectory = join(first.outputDirectory, "licenses");
    const victim = await mkdtemp(
      join(tmpdir(), "aleksi-release-junction-victim-")
    );
    temporaryDirectories.push(victim);
    const sentinel = join(victim, "must-survive.txt");
    await writeFile(sentinel, "preserve", "utf8");
    await rm(licensesDirectory, { force: true, recursive: true });
    await symlink(
      victim,
      licensesDirectory,
      process.platform === "win32" ? "junction" : "dir"
    );

    await expect(
      releasePackager.generateReleaseEvidence(options(root))
    ).rejects.toThrow(/symbolic-link|junction/u);
    await expect(readFile(sentinel, "utf8")).resolves.toBe("preserve");
    await unlink(licensesDirectory);
  });

  it("keeps only self-contained installed evidence that matches the frozen release", async () => {
    const root = await makeFixture();
    const first = await releasePackager.generateReleaseEvidence(options(root));
    const outputDirectory = first.outputDirectory;
    const evidencePath = join(
      outputDirectory,
      "installed-desktop-evidence.json"
    );
    const installer = await readFile(
      join(outputDirectory, canonicalIdentity.installerFilename)
    );
    const installerHash = createHash("sha256")
      .update(installer)
      .digest("hex");
    const evidence = installedEvidenceFixture(
      installer.length,
      installerHash
    );
    await materializeInstalledBackup(root, evidence);
    const evidenceSource = `${JSON.stringify(evidence, null, 2)}\n`;
    await Promise.all([
      writeFile(evidencePath, evidenceSource, "utf8"),
      writeFile(
        join(outputDirectory, "smoke-test-report.md"),
        "Status: PASSED\n",
        "utf8"
      ),
      writeFile(
        join(outputDirectory, "upgrade-test-report.md"),
        "Status: PASSED\n",
        "utf8"
      )
    ]);

    const valid = await releasePackager.generateReleaseEvidence(options(root));
    const canonicalEvidenceSource = await readFile(evidencePath, "utf8");
    const canonicalEvidenceHash = createHash("sha256")
      .update(canonicalEvidenceSource)
      .digest("hex");
    expect(
      valid.manifest.artifacts.find(
        (artifact) => artifact.path === "installed-desktop-evidence.json"
      )
    ).toMatchObject({
      bytes: Buffer.byteLength(canonicalEvidenceSource),
      sha256: canonicalEvidenceHash
    });
    await expect(
      readFile(join(outputDirectory, "smoke-test-report.md"), "utf8")
    ).resolves.toContain(
      `- Installed evidence SHA-256: ${canonicalEvidenceHash}`
    );
    await expect(
      readFile(join(outputDirectory, "smoke-test-report.md"), "utf8")
    ).resolves.toContain("Cold/warm sidecar readiness: 800 ms / 600 ms");
    await expect(
      readFile(join(outputDirectory, "upgrade-test-report.md"), "utf8")
    ).resolves.toContain(
      "regular-file path, byte length, and SHA-256 inventories were identical"
    );

    await writeFile(
      evidencePath,
      `${JSON.stringify({
        ...evidence,
        installer: { ...evidence.installer, sha256: "f".repeat(64) }
      })}\n`,
      "utf8"
    );
    const stale = await releasePackager.generateReleaseEvidence(options(root));
    expect(
      stale.manifest.artifacts.some(
        (artifact) => artifact.path === "installed-desktop-evidence.json"
      )
    ).toBe(false);
    await expect(readFile(evidencePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(
      readFile(join(outputDirectory, "smoke-test-report.md"), "utf8")
    ).resolves.toContain("Status: NOT RUN");
    await expect(
      readFile(join(outputDirectory, "upgrade-test-report.md"), "utf8")
    ).resolves.toContain("- Installed evidence SHA-256: absent");
  });

  it("rejects installed evidence with unknown fields or local absolute paths", async () => {
    const root = await makeFixture();
    const first = await releasePackager.generateReleaseEvidence(options(root));
    const outputDirectory = first.outputDirectory;
    const evidencePath = join(
      outputDirectory,
      "installed-desktop-evidence.json"
    );
    const installer = await readFile(
      join(outputDirectory, canonicalIdentity.installerFilename)
    );
    const installerHash = createHash("sha256")
      .update(installer)
      .digest("hex");
    const evidence = installedEvidenceFixture(installer.length, installerHash);

    await writeFile(
      evidencePath,
      `${JSON.stringify({
        ...evidence,
        leakedAbsolutePath: "C:\\Users\\pcp\\secret"
      })}\n`,
      "utf8"
    );
    const unknownField = await releasePackager.generateReleaseEvidence(
      options(root)
    );
    expect(
      unknownField.manifest.artifacts.some(
        (artifact) => artifact.path === "installed-desktop-evidence.json"
      )
    ).toBe(false);
    await expect(
      readFile(join(outputDirectory, "smoke-test-report.md"), "utf8")
    ).resolves.toContain("Status: NOT RUN");

    await writeFile(
      evidencePath,
      `${JSON.stringify({
        ...evidence,
        installation: {
          ...evidence.installation,
          executablePath: "C:\\Users\\pcp\\AppData\\Local\\Aleksi Workbench\\aleksi-workbench.exe"
        }
      })}\n`,
      "utf8"
    );
    const absolutePath = await releasePackager.generateReleaseEvidence(
      options(root)
    );
    expect(
      absolutePath.manifest.artifacts.some(
        (artifact) => artifact.path === "installed-desktop-evidence.json"
      )
    ).toBe(false);
    await expect(
      readFile(join(outputDirectory, "upgrade-test-report.md"), "utf8")
    ).resolves.toContain("- Installed evidence SHA-256: absent");
  });

  it("canonicalizes only lifecycle evidence bound to the installed evidence and frozen release", async () => {
    const root = await makeFixture();
    const first = await releasePackager.generateReleaseEvidence(options(root));
    const outputDirectory = first.outputDirectory;
    const installer = await readFile(
      join(outputDirectory, canonicalIdentity.installerFilename)
    );
    const installerHash = createHash("sha256")
      .update(installer)
      .digest("hex");
    const installedEvidencePath = join(
      outputDirectory,
      "installed-desktop-evidence.json"
    );
    const installedFixture = installedEvidenceFixture(
      installer.length,
      installerHash
    );
    await materializeInstalledBackup(root, installedFixture);
    await writeFile(
      installedEvidencePath,
      `${JSON.stringify(installedFixture, null, 2)}\n`,
      "utf8"
    );
    await releasePackager.generateReleaseEvidence(options(root));
    const installedEvidenceSource = await readFile(
      installedEvidencePath,
      "utf8"
    );
    const installedEvidence = JSON.parse(
      installedEvidenceSource
    ) as ReturnType<typeof installedEvidenceFixture>;
    const runtimeIdentitySource = await readFile(
      join(root, "src-tauri/resources/identity.json"),
      "utf8"
    );
    const evidence = lifecycleEvidenceFixture(
      installer.length,
      installerHash,
      installedEvidenceSource,
      installedEvidence,
      runtimeIdentitySource
    );
    await materializeLifecycleBackup(root, evidence);
    const evidenceSource = `${JSON.stringify(evidence, null, 2)}\n`;
    const evidencePath = join(
      outputDirectory,
      "uninstall-reinstall-evidence.json"
    );
    const reportPath = join(outputDirectory, "uninstall-test-report.md");
    await Promise.all([
      writeFile(evidencePath, evidenceSource, "utf8"),
      writeFile(reportPath, "Status: PASSED\n", "utf8")
    ]);

    const valid = await releasePackager.generateReleaseEvidence(options(root));
    const canonicalLifecycleSource = await readFile(evidencePath, "utf8");
    const canonicalLifecycleHash = createHash("sha256")
      .update(canonicalLifecycleSource)
      .digest("hex");
    const canonicalInstalledHash = createHash("sha256")
      .update(installedEvidenceSource)
      .digest("hex");
    expect(
      valid.manifest.artifacts.map((artifact) => artifact.path)
    ).toEqual(
      expect.arrayContaining([
        "uninstall-reinstall-evidence.json",
        "uninstall-test-report.md"
      ])
    );
    expect(
      valid.manifest.artifacts.find(
        (artifact) => artifact.path === "uninstall-reinstall-evidence.json"
      )
    ).toMatchObject({ sha256: canonicalLifecycleHash });
    await expect(readFile(reportPath, "utf8")).resolves.toContain(
      `- Installed evidence SHA-256: ${canonicalInstalledHash}`
    );
    await expect(readFile(reportPath, "utf8")).resolves.toContain(
      `- Lifecycle evidence SHA-256: ${canonicalLifecycleHash}`
    );
    await expect(readFile(reportPath, "utf8")).resolves.toContain(
      "after-uninstall="
    );

    await writeFile(
      reportPath,
      "Status: PASSED\n- leaked path: C:\\Users\\pcp\\secret\n",
      "utf8"
    );
    const repaired = await releasePackager.generateReleaseEvidence(options(root));
    expect(
      repaired.manifest.artifacts.map((artifact) => artifact.path)
    ).toEqual(
      expect.arrayContaining([
        "uninstall-reinstall-evidence.json",
        "uninstall-test-report.md"
      ])
    );
    await expect(readFile(reportPath, "utf8")).resolves.not.toContain(
      "C:\\Users\\pcp\\secret"
    );

    await writeFile(
      evidencePath,
      `${JSON.stringify({
        ...evidence,
        installedEvidence: {
          ...evidence.installedEvidence,
          sha256: "e".repeat(64)
        }
      })}\n`,
      "utf8"
    );
    const stale = await releasePackager.generateReleaseEvidence(options(root));
    expect(
      stale.manifest.artifacts.map((artifact) => artifact.path)
    ).not.toEqual(
      expect.arrayContaining([
        "uninstall-reinstall-evidence.json",
        "uninstall-test-report.md"
      ])
    );
    await expect(readFile(evidencePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(reportPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects lifecycle evidence when fingerprints, executable identity, or paths drift", async () => {
    const root = await makeFixture();
    const first = await releasePackager.generateReleaseEvidence(options(root));
    const outputDirectory = first.outputDirectory;
    const installer = await readFile(
      join(outputDirectory, canonicalIdentity.installerFilename)
    );
    const installerHash = createHash("sha256")
      .update(installer)
      .digest("hex");
    const installedEvidencePath = join(
      outputDirectory,
      "installed-desktop-evidence.json"
    );
    const installedFixture = installedEvidenceFixture(
      installer.length,
      installerHash
    );
    await materializeInstalledBackup(root, installedFixture);
    await writeFile(
      installedEvidencePath,
      `${JSON.stringify(installedFixture, null, 2)}\n`,
      "utf8"
    );
    await releasePackager.generateReleaseEvidence(options(root));
    const installedEvidenceSource = await readFile(
      installedEvidencePath,
      "utf8"
    );
    const installedEvidence = JSON.parse(
      installedEvidenceSource
    ) as ReturnType<typeof installedEvidenceFixture>;
    const runtimeIdentitySource = await readFile(
      join(root, "src-tauri/resources/identity.json"),
      "utf8"
    );
    const evidence = lifecycleEvidenceFixture(
      installer.length,
      installerHash,
      installedEvidenceSource,
      installedEvidence,
      runtimeIdentitySource
    );
    await materializeLifecycleBackup(root, evidence);
    const evidencePath = join(
      outputDirectory,
      "uninstall-reinstall-evidence.json"
    );
    const reportPath = join(outputDirectory, "uninstall-test-report.md");

    const variants = [
      {
        ...evidence,
        installation: {
          ...evidence.installation,
          executableBytesAfter: evidence.installation.executableBytesAfter + 1
        }
      },
      {
        ...evidence,
        userDataFingerprintsAfterReinstall:
          evidence.userDataFingerprintsAfterReinstall.map((entry, index) =>
            index === 0 ? { ...entry, digest: "8".repeat(64) } : entry
          )
      },
      {
        ...evidence,
        backup: {
          ...evidence.backup,
          root: "C:\\Users\\pcp\\backup",
          manifestPath: "C:\\Users\\pcp\\backup\\manifest.json"
        }
      },
      {
        ...evidence,
        leakedAbsolutePath: "C:\\Users\\pcp\\secret"
      },
      {
        ...evidence,
        testedAtUtc: "2026-07-22T11:59:59.000Z"
      }
    ];

    for (const variant of variants) {
      await writeFile(
        evidencePath,
        `${JSON.stringify(variant, null, 2)}\n`,
        "utf8"
      );
      const result = await releasePackager.generateReleaseEvidence(
        options(root)
      );
      expect(
        result.manifest.artifacts.some(
          (artifact) =>
            artifact.path === "uninstall-reinstall-evidence.json" ||
            artifact.path === "uninstall-test-report.md"
        )
      ).toBe(false);
      await expect(readFile(evidencePath, "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(readFile(reportPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    }

    const expectCurrentLifecycleRejected = async (): Promise<void> => {
      await writeFile(
        evidencePath,
        `${JSON.stringify(evidence, null, 2)}\n`,
        "utf8"
      );
      const result = await releasePackager.generateReleaseEvidence(
        options(root)
      );
      expect(
        result.manifest.artifacts.some(
          (artifact) =>
            artifact.path === "uninstall-reinstall-evidence.json" ||
            artifact.path === "uninstall-test-report.md"
        )
      ).toBe(false);
    };

    await materializeLifecycleBackup(root, evidence);
    const declaredFilePath = join(
      root,
      ...`${evidence.backup.root}/data/root-01/file-00.bin`.split("/")
    );
    const declaredFile = await readFile(declaredFilePath);
    declaredFile[0] ^= 0xff;
    await writeFile(declaredFilePath, declaredFile);
    await expectCurrentLifecycleRejected();

    await materializeLifecycleBackup(root, evidence);
    await writeFixtureFile(
      root,
      `${evidence.backup.root}/data/root-01/unlisted-extra.bin`,
      Buffer.from("extra")
    );
    await expectCurrentLifecycleRejected();

    await materializeLifecycleBackup(root, evidence);
    const manifestPath = join(
      root,
      ...evidence.backup.manifestPath.split("/")
    );
    const traversalManifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as {
      roots: Array<{
        files: Array<{ path: string }>;
      }>;
    };
    traversalManifest.roots[1].files[0].path = "../escape.bin";
    const traversalSource = `${JSON.stringify(traversalManifest, null, 2)}\n`;
    evidence.backup.manifestBytes = Buffer.byteLength(traversalSource);
    evidence.backup.manifestSha256 = createHash("sha256")
      .update(traversalSource)
      .digest("hex");
    await writeFile(manifestPath, traversalSource, "utf8");
    await expectCurrentLifecycleRejected();

    await materializeLifecycleBackup(root, evidence);
    const unknownFieldManifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as Record<string, unknown>;
    unknownFieldManifest.leakedAbsolutePath = "C:\\Users\\pcp\\secret";
    const unknownFieldSource =
      `${JSON.stringify(unknownFieldManifest, null, 2)}\n`;
    evidence.backup.manifestBytes = Buffer.byteLength(unknownFieldSource);
    evidence.backup.manifestSha256 = createHash("sha256")
      .update(unknownFieldSource)
      .digest("hex");
    await writeFile(manifestPath, unknownFieldSource, "utf8");
    await expectCurrentLifecycleRejected();
  });

  it("records an evidence-only package and removes a stale checksum when no installer exists", async () => {
    const root = await makeFixture();
    await releasePackager.generateReleaseEvidence(options(root));
    const outputDirectory = join(root, ...canonicalIdentity.releaseDirectory.split("/"));
    await rm(join(outputDirectory, canonicalIdentity.installerFilename));

    const result = await releasePackager.generateReleaseEvidence(options(root));
    expect(result.manifest.installerStatus).toBe("absent");
    expect(result.manifest.installer).toBeNull();
    await expect(
      readFile(
        join(outputDirectory, `${canonicalIdentity.installerFilename}.sha256`),
        "utf8"
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(outputDirectory, "known-limitations.md"), "utf8")
    ).resolves.toContain("No installer was present when this evidence bundle was generated");
  });

  it("rejects release evidence when source versions drift", async () => {
    const root = await makeFixture(false);
    await writeFixtureFile(
      root,
      "package.json",
      `${JSON.stringify({ name: "aleksi-learning-workbench", version: "9.9.9" })}\n`
    );

    await expect(
      releasePackager.generateReleaseEvidence(options(root))
    ).rejects.toThrow(
      /package\.json version is 9\.9\.9; expected canonical version 0\.1\.3/u
    );
  });

  it("wires desktop packaging and the explicit release-evidence command", async () => {
    const root = process.cwd();
    const [packageJson, desktopPackager] = await Promise.all([
      readFile(join(root, "package.json"), "utf8").then(
        (source) => JSON.parse(source) as { scripts: Record<string, string> }
      ),
      readFile(join(root, "scripts/package-desktop.mjs"), "utf8")
    ]);

    expect(packageJson.scripts["package:release"]).toBe(
      "node scripts/package-release.mjs"
    );
    expect(desktopPackager).toContain("generateReleaseEvidence");
  });
});
