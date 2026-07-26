import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type ReportModule = {
  writeInstalledTestReports: (options: {
    evidencePath: string;
    root: string;
  }) => Promise<{
    evidenceHash: string;
    installerHash: string;
    releaseDirectory: string;
  }>;
};

const temporaryDirectories: string[] = [];
let reportModule: ReportModule;

async function writeFixture(path: string, value: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

beforeAll(async () => {
  reportModule = (await import(
    pathToFileURL(join(process.cwd(), "scripts/write-installed-test-reports.mjs")).href
  )) as ReportModule;
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true })
    )
  );
});

describe("installed verification report writer", () => {
  it("anchors passing reports to the canonical installer and measured evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "aleksi-installed-report-"));
    temporaryDirectories.push(root);
    const releaseDirectory = "artifacts/release/aleksi-workbench/0.1.2";
    const installerFilename = "Aleksi-Workbench-0.1.2-Setup.exe";
    const installer = Buffer.from("fixture installer");
    const installerHash = createHash("sha256").update(installer).digest("hex");
    const identity = {
      displayName: "Aleksi Workbench",
      executableName: "aleksi-workbench.exe",
      installerFilename,
      localProtocolVersion: 1,
      nodeRuntime: { version: "v22.23.1", sha256: "a".repeat(64) },
      releaseDirectory,
      upgradeFrom: {
        version: "0.1.1",
        installerFilename: "Aleksi-Workbench-0.1.1-Verified-Setup.exe",
        installerBytes: 26_118_082,
        installerSha256: "b".repeat(64),
        installedExecutableBytes: 10_420_224,
        installedExecutableSha256: "c".repeat(64)
      },
      projectSchemaVersion: 2,
      upgradeFromVersion: "0.1.1",
      version: "0.1.2",
      windowsPathContracts: {
        install: "%LOCALAPPDATA%\\Aleksi Workbench"
      }
    };
    const manifest = {
      installer: { bytes: installer.length, path: installerFilename, sha256: installerHash },
      shellBuildId: "desktop-aaaaaaaaaaaaaaaaaaaa",
      sidecarBuildId: "sidecar-bbbbbbbbbbbbbbbbbbbb"
    };
    const evidence: any = {
      schemaVersion: 1,
      result: "passed",
      testedAtUtc: "2026-07-22T12:00:00.000Z",
      evidenceBoundary:
        "developer-machine-installed-shell-and-isolated-packaged-sidecar",
      installer: {
        path: installerFilename,
        bytes: installer.length,
        sha256: installerHash,
        peMachine: "I386",
        authenticodeStatus: "NotSigned",
        manifestPath: "release-manifest.json"
      },
      upgrade: {
        previousVersion: "0.1.1",
        installedVersion: "0.1.2",
        predecessorInstaller: {
          path: identity.upgradeFrom.installerFilename,
          bytes: identity.upgradeFrom.installerBytes,
          sha256: identity.upgradeFrom.installerSha256,
          version: identity.upgradeFrom.version,
          peMachine: "I386",
          authenticodeStatus: "NotSigned"
        },
        predecessorInstallation: {
          executableBytes: identity.upgradeFrom.installedExecutableBytes,
          executableSha256: identity.upgradeFrom.installedExecutableSha256,
          version: identity.upgradeFrom.version,
          executablePath:
            "%LOCALAPPDATA%\\Aleksi Workbench\\aleksi-workbench.exe",
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
          bytes: 72,
          sourceFingerprintDigest: "3".repeat(64),
          backupFingerprintDigest: "3".repeat(64)
        },
        userDataPreservedByInstaller: true,
        userDataFingerprintsBefore: [
          {
            label: "%APPDATA%\\Aleksi Learning Workbench",
            exists: false,
            fileCount: 0,
            bytes: 0,
            digest: "c".repeat(64)
          },
          {
            label: "%APPDATA%\\io.aleksi.workbench",
            exists: true,
            fileCount: 1,
            bytes: 12,
            digest: "d".repeat(64)
          },
          {
            label: "%LOCALAPPDATA%\\io.aleksi.workbench",
            exists: true,
            fileCount: 2,
            bytes: 24,
            digest: "e".repeat(64)
          },
          {
            label: "%USERPROFILE%\\Documents\\Aleksi Learning Workbench",
            exists: true,
            fileCount: 3,
            bytes: 36,
            digest: "f".repeat(64)
          }
        ],
        userDataFingerprintsAfter: []
      },
      identity: {
        product: "Aleksi Workbench",
        version: "0.1.2",
        schemaVersion: 2,
        protocolVersion: 1,
        shellBuildId: manifest.shellBuildId,
        sidecarBuildId: manifest.sidecarBuildId,
        nodeVersion: "v22.23.1",
        nodeSha256: "a".repeat(64)
      },
      installation: {
        executablePath:
          "%LOCALAPPDATA%\\Aleksi Workbench\\aleksi-workbench.exe",
        executableAuthenticodeStatus: "NotSigned",
        executableBytes: 10_420_224,
        executableSha256: "d".repeat(64),
        installRoot: "%LOCALAPPDATA%\\Aleksi Workbench",
        uninstallerPath:
          "%LOCALAPPDATA%\\Aleksi Workbench\\uninstall.exe",
        uninstallerBytes: 3_000_000,
        uninstallerSha256: "1".repeat(64),
        uninstallerPeMachine: "I386",
        uninstallerAuthenticodeStatus: "NotSigned",
        bytes: 100_000_000,
        fileCount: 7
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
    evidence.upgrade.userDataFingerprintsAfter =
      structuredClone(evidence.upgrade.userDataFingerprintsBefore);
    const evidencePath = join(root, "artifacts/review/installed-desktop-report.json");

    await Promise.all([
      writeFixture(join(root, "release/identity.json"), JSON.stringify(identity)),
      writeFixture(join(root, releaseDirectory, installerFilename), installer),
      writeFixture(join(root, releaseDirectory, "release-manifest.json"), JSON.stringify(manifest)),
      writeFixture(evidencePath, `\uFEFF${JSON.stringify(evidence)}`)
    ]);

    const result = await reportModule.writeInstalledTestReports({
      root,
      evidencePath
    });
    const [embeddedEvidence, smoke, upgrade] = await Promise.all([
      readFile(
        join(root, releaseDirectory, "installed-desktop-evidence.json"),
        "utf8"
      ),
      readFile(join(root, releaseDirectory, "smoke-test-report.md"), "utf8"),
      readFile(join(root, releaseDirectory, "upgrade-test-report.md"), "utf8")
    ]);
    expect(embeddedEvidence.charCodeAt(0)).not.toBe(0xfeff);
    expect(createHash("sha256").update(embeddedEvidence).digest("hex")).toBe(
      result.evidenceHash
    );
    expect(smoke).toContain("Status: PASSED");
    expect(smoke).toContain(`- Installer SHA-256: ${installerHash}`);
    expect(smoke).toContain(
      "- Installed evidence: installed-desktop-evidence.json"
    );
    expect(smoke).toContain(
      `- Installed evidence SHA-256: ${result.evidenceHash}`
    );
    expect(smoke).toContain("Cold/warm sidecar readiness: 800 ms / 600 ms");
    expect(smoke).toContain(
      `Installed uninstaller: I386, NotSigned, 3000000 bytes, SHA-256 ${"1".repeat(64)}`
    );
    expect(smoke).toContain("not clean-machine or visual-workflow evidence");
    expect(upgrade).toContain("Upgrade: 0.1.1 -> 0.1.2");
    expect(upgrade).toContain(identity.upgradeFrom.installerSha256);
    expect(upgrade).toContain(identity.upgradeFrom.installedExecutableSha256);
    expect(upgrade).toContain(
      "regular-file path, byte length, and SHA-256 inventories were identical"
    );

    evidence.upgrade.predecessorInstaller.sha256 = "f".repeat(64);
    await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
    await expect(
      reportModule.writeInstalledTestReports({ root, evidencePath })
    ).rejects.toThrow(/Predecessor installer SHA-256/u);

    evidence.upgrade.predecessorInstaller.sha256 =
      identity.upgradeFrom.installerSha256;
    evidence.installation.uninstallerPeMachine = "AMD64";
    await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
    await expect(
      reportModule.writeInstalledTestReports({ root, evidencePath })
    ).rejects.toThrow(/Installed uninstaller PE machine/u);

    evidence.installation.uninstallerPeMachine = "I386";
    evidence.runtime.warmMemory.sidecarProcessCount = 0;
    await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
    await expect(
      reportModule.writeInstalledTestReports({ root, evidencePath })
    ).rejects.toThrow(/runtime\.warmMemory\.sidecarProcessCount/u);
  });

  it("rejects evidence for a different installer", async () => {
    const root = await mkdtemp(join(tmpdir(), "aleksi-installed-report-reject-"));
    temporaryDirectories.push(root);
    const releaseDirectory = "artifacts/release/aleksi-workbench/0.1.2";
    await Promise.all([
      writeFixture(
        join(root, "release/identity.json"),
        JSON.stringify({
          displayName: "Aleksi Workbench",
          installerFilename: "Aleksi-Workbench-0.1.2-Setup.exe",
          localProtocolVersion: 1,
          nodeRuntime: { version: "v22.23.1", sha256: "a".repeat(64) },
          releaseDirectory,
          upgradeFrom: {
            version: "0.1.1",
            installerFilename: "Aleksi-Workbench-0.1.1-Verified-Setup.exe",
            installerBytes: 1,
            installerSha256: "d".repeat(64),
            installedExecutableBytes: 1,
            installedExecutableSha256: "e".repeat(64)
          },
          upgradeFromVersion: "0.1.1",
          version: "0.1.2"
        })
      ),
      writeFixture(join(root, releaseDirectory, "Aleksi-Workbench-0.1.2-Setup.exe"), "installer"),
      writeFixture(
        join(root, releaseDirectory, "release-manifest.json"),
        JSON.stringify({ installer: { sha256: "b".repeat(64) } })
      ),
      writeFixture(
        join(root, "evidence.json"),
        JSON.stringify({ schemaVersion: 1, result: "passed", installer: { sha256: "c".repeat(64) } })
      )
    ]);

    await expect(
      reportModule.writeInstalledTestReports({ root, evidencePath: join(root, "evidence.json") })
    ).rejects.toThrow(/installer SHA-256/u);
  });
});
