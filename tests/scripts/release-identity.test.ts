import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type ReleaseIdentity = Record<string, unknown> & {
  description: string;
  displayName: string;
  identifier: string;
  installerFilename: string;
  localProtocolVersion: number;
  nodeRuntime: {
    architecture: string;
    licensePath: string;
    licenseSha256: string;
    officialDownloadUrl: string;
    officialLicenseUrl: string;
    platform: string;
    sha256: string;
    version: string;
  };
  projectSchemaVersion: number;
  releaseDirectory: string;
  shortName: string;
  upgradeFrom: {
    installedExecutableBytes: number;
    installedExecutableSha256: string;
    installerBytes: number;
    installerFilename: string;
    installerSha256: string;
    version: string;
  };
  version: string;
  windowsPathContracts: Record<string, string>;
  webView2: {
    installMode: string;
    policy: string;
  };
};

type ReleaseSources = {
  cargoLock: string;
  cargoToml: string;
  desktopPackageRulesSource: string;
  packageJson: Record<string, unknown>;
  prepareDesktopSource: string;
  tauriConfig: Record<string, unknown>;
};

type VerifierModule = {
  collectSourceAlignmentErrors: (
    identity: ReleaseIdentity,
    sources: ReleaseSources,
    options?: { allowSourceVersionMismatch?: boolean }
  ) => string[];
  validateReleaseIdentityDocument: (input: unknown) => ReleaseIdentity;
};

let canonicalIdentity: ReleaseIdentity;
let verifier: VerifierModule;

function alignedSources(identity: ReleaseIdentity): ReleaseSources {
  return {
    packageJson: {
      name: "aleksi-learning-workbench",
      version: identity.version
    },
    cargoToml: `[package]\nname = "aleksi-workbench"\nversion = "${identity.version}"\n`,
    cargoLock: `[[package]]\nname = "aleksi-workbench"\nversion = "${identity.version}"\n`,
    tauriConfig: {
      productName: identity.displayName,
      version: identity.version,
      identifier: identity.identifier,
      app: {
        windows: [{ title: identity.displayName }]
      },
      bundle: {
        publisher: identity.publisher,
        longDescription: identity.description,
        windows: {
          nsis: { installMode: "currentUser" },
          webviewInstallMode: { type: identity.webView2.installMode }
        }
      }
    },
    prepareDesktopSource: `
      const canonicalReleaseIdentityPath = resolve(root, "release/identity.json");
      const releaseIdentity = JSON.parse(await readFile(canonicalReleaseIdentityPath, "utf8"));
      const identity = {
        schemaVersion: releaseIdentity.projectSchemaVersion,
        product: releaseIdentity.displayName,
        version: releaseIdentity.version,
        protocolVersion: releaseIdentity.localProtocolVersion,
        nodeVersion: releaseIdentity.nodeRuntime.version
      };
    `,
    desktopPackageRulesSource: `
      const canonicalReleaseIdentityPath = "release/identity.json";
      const releaseIdentity = {
        installerFilename: "${identity.installerFilename}",
        releaseDirectory: "${identity.releaseDirectory}"
      };
      export const DESKTOP_INSTALLER_PATH =
        releaseIdentity.releaseDirectory + "/" + releaseIdentity.installerFilename;
    `
  };
}

beforeAll(async () => {
  const root = process.cwd();
  canonicalIdentity = JSON.parse(
    await readFile(join(root, "release/identity.json"), "utf8")
  ) as ReleaseIdentity;
  verifier = (await import(
    pathToFileURL(join(root, "scripts/verify-release-identity.mjs")).href
  )) as VerifierModule;
});

describe("canonical release identity", () => {
  it("defines the complete 0.1.2 Windows release contract", () => {
    const parsed = verifier.validateReleaseIdentityDocument(canonicalIdentity);

    expect(parsed).toMatchObject({
      displayName: "Aleksi Workbench",
      shortName: "Aleksi",
      version: "0.1.2",
      upgradeFromVersion: "0.1.1",
      upgradeFrom: {
        version: "0.1.1",
        installerFilename: "Aleksi-Workbench-0.1.1-Verified-Setup.exe",
        installerBytes: 26_118_082,
        installerSha256:
          "3b462c627aa82bfeccaf3f666bb09e86119456354830c0135335186cb355c9a5",
        installedExecutableBytes: 10_420_224,
        installedExecutableSha256:
          "1de3057f6405c65ec5be3f0d4edda09ecb03e5c86d24f9203a949b4dd3e59f22"
      },
      identifier: "io.aleksi.workbench",
      publisher: "Aleksi",
      company: "Aleksi",
      executableName: "aleksi-workbench.exe",
      installerFilename: "Aleksi-Workbench-0.1.2-Setup.exe",
      releaseDirectory: "artifacts/release/aleksi-workbench/0.1.2",
      projectSchemaVersion: 2,
      localProtocolVersion: 1,
      nodeRuntime: {
        version: "v22.23.1",
        platform: "win32",
        architecture: "x64",
        sha256: "f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed",
        licenseSha256: "c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4"
      },
      signing: {
        status: "unsigned-preview",
        metadataOnly: true,
        legalPublisherStatus: "pending-user-confirmation"
      },
      webView2: {
        policy: "online-light",
        installMode: "downloadBootstrapper",
        networkRequiredWhenMissing: true
      }
    });
    expect(Object.keys(parsed.windowsPathContracts).sort()).toEqual([
      "backup",
      "cache",
      "config",
      "data",
      "defaultLibrary",
      "fallbackLibrary",
      "install",
      "log"
    ]);
  });

  it("rejects blank, unknown, and version-inconsistent identity fields", () => {
    expect(() =>
      verifier.validateReleaseIdentityDocument({
        ...canonicalIdentity,
        publisher: ""
      })
    ).toThrow(/publisher must be a non-blank string/u);

    expect(() =>
      verifier.validateReleaseIdentityDocument({
        ...canonicalIdentity,
        unexpected: true
      })
    ).toThrow(/unknown field "unexpected"/u);

    expect(() =>
      verifier.validateReleaseIdentityDocument({
        ...canonicalIdentity,
        installerFilename: "Aleksi-Workbench-9.9.9-Setup.exe"
      })
    ).toThrow(/installerFilename must be Aleksi-Workbench-0\.1\.2-Setup\.exe/u);

    expect(() =>
      verifier.validateReleaseIdentityDocument({
        ...canonicalIdentity,
        nodeRuntime: { ...canonicalIdentity.nodeRuntime, sha256: "unverified" }
      })
    ).toThrow(/nodeRuntime\.sha256 must be a lowercase SHA-256/u);

    expect(() =>
      verifier.validateReleaseIdentityDocument({
        ...canonicalIdentity,
        upgradeFrom: {
          ...canonicalIdentity.upgradeFrom,
          installerSha256: "unverified"
        }
      })
    ).toThrow(/upgradeFrom\.installerSha256 must be a lowercase SHA-256/u);

    expect(() =>
      verifier.validateReleaseIdentityDocument({
        ...canonicalIdentity,
        upgradeFrom: {
          ...canonicalIdentity.upgradeFrom,
          installedExecutableBytes: 0
        }
      })
    ).toThrow(/upgradeFrom\.installedExecutableBytes must be a positive integer/u);

    expect(() =>
      verifier.validateReleaseIdentityDocument({
        ...canonicalIdentity,
        upgradeFrom: {
          ...canonicalIdentity.upgradeFrom,
          version: "0.1.0"
        }
      })
    ).toThrow(/upgradeFrom\.version must match upgradeFromVersion/u);
  });

  it("accepts a fully aligned release-source snapshot", () => {
    expect(
      verifier.collectSourceAlignmentErrors(
        canonicalIdentity,
        alignedSources(canonicalIdentity)
      )
    ).toEqual([]);
  });

  it("reports version, Tauri, prepare, and release-name drift", () => {
    const sources = alignedSources(canonicalIdentity);
    sources.packageJson = { ...sources.packageJson, version: "0.1.1" };
    sources.tauriConfig = {
      ...sources.tauriConfig,
      productName: "Aleksi Workbench Desktop"
    };
    sources.prepareDesktopSource = "const identity = { version: packageJson.version };";
    sources.desktopPackageRulesSource =
      'export const DESKTOP_INSTALLER_PATH = "artifacts/Aleksi-Workbench-Setup.exe";';

    const errors = verifier.collectSourceAlignmentErrors(
      canonicalIdentity,
      sources
    );
    expect(errors).toContain(
      "package.json version is 0.1.1; expected canonical version 0.1.2"
    );
    expect(errors).toContain(
      "src-tauri/tauri.conf.json productName is Aleksi Workbench Desktop; expected Aleksi Workbench"
    );
    expect(errors).toContain(
      "scripts/prepare-desktop.mjs must consume release/identity.json"
    );
    expect(errors).toContain(
      "scripts/desktop-package-rules.mjs must derive its installer path from release/identity.json"
    );
  });

  it("can isolate a deliberate pre-upgrade source-version mismatch", () => {
    const sources = alignedSources(canonicalIdentity);
    sources.packageJson = { ...sources.packageJson, version: "0.1.1" };
    sources.cargoToml = sources.cargoToml.replace("0.1.2", "0.1.1");
    sources.cargoLock = sources.cargoLock.replace("0.1.2", "0.1.1");
    sources.tauriConfig = { ...sources.tauriConfig, version: "0.1.1" };

    expect(
      verifier.collectSourceAlignmentErrors(canonicalIdentity, sources, {
        allowSourceVersionMismatch: true
      })
    ).toEqual([]);
  });
});
