import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { verifyReleaseManifest } from "../../scripts/verify-release-manifest.mjs";

const temporaryDirectories: string[] = [];
const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true })
    )
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aleksi-manifest-contract-"));
  temporaryDirectories.push(root);
  const identity = JSON.parse(
    await readFile(join(process.cwd(), "release/identity.json"), "utf8")
  ) as {
    identifier: string;
    legalPublisherStatus?: string;
    releaseDirectory: string;
    signing: {
      legalPublisherStatus: string;
      status: string;
    };
    upgradeFrom: unknown;
    upgradeFromVersion: string;
    version: string;
    webView2: unknown;
  };
  const schema = await readFile(
    join(process.cwd(), "release/release-manifest.schema.json"),
    "utf8"
  );
  await mkdir(join(root, "release"), { recursive: true });
  await writeFile(
    join(root, "release/identity.json"),
    `${JSON.stringify(identity, null, 2)}\n`
  );
  await writeFile(join(root, "release/release-manifest.schema.json"), schema);

  const releaseDirectory = join(root, ...identity.releaseDirectory.split("/"));
  await mkdir(releaseDirectory, { recursive: true });
  const evidence = Buffer.from("bounded synthetic release evidence\n");
  await writeFile(join(releaseDirectory, "evidence.txt"), evidence);
  const manifest = {
    schemaVersion: 3,
    packageType: "tauri-nsis",
    product: "Aleksi Workbench",
    shortName: "Aleksi",
    identifier: identity.identifier,
    version: identity.version,
    commit: "1".repeat(40),
    dirty: false,
    buildDate: "2026-07-29T00:00:00.000Z",
    platform: "windows",
    architecture: "x64",
    targetTriple: "x86_64-pc-windows-msvc",
    tauriVersion: "2.11.4",
    projectSchemaVersion: 2,
    upgradeFromVersion: identity.upgradeFromVersion,
    upgradeFrom: identity.upgradeFrom,
    localProtocolVersion: 1,
    protocolVersion: 1,
    buildId: `desktop-${"2".repeat(20)}`,
    shellBuildId: `desktop-${"2".repeat(20)}`,
    sidecarBuildId: `sidecar-${"3".repeat(20)}`,
    nodeVersion: "v22.23.1",
    webView2: identity.webView2,
    signed: false,
    signingStatus: identity.signing.status,
    legalPublisherStatus: identity.signing.legalPublisherStatus,
    sourceInstaller: null,
    installerStatus: "absent",
    installer: null,
    artifactHashAlgorithm: "SHA-256",
    hashCoverage:
      "Every regular file in this release directory except release-manifest.json itself.",
    artifacts: [
      {
        bytes: evidence.length,
        path: "evidence.txt",
        sha256: sha256(evidence)
      }
    ]
  };
  const manifestPath = join(releaseDirectory, "release-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestPath, releaseDirectory, root };
}

describe("release manifest verifier", () => {
  it("accepts a clean, identity-bound, fully hashed evidence inventory", async () => {
    const setup = await fixture();

    const result = await verifyReleaseManifest({
      allowAbsentInstaller: true,
      root: setup.root
    });

    expect(result.manifest.version).toBe("0.1.5-rc.1");
    expect(result.releaseDirectory).toBe(setup.releaseDirectory);
  });

  it("rejects artifact drift and unlisted files", async () => {
    const setup = await fixture();
    await writeFile(
      join(setup.releaseDirectory, "evidence.txt"),
      Buffer.alloc(setup.manifest.artifacts[0].bytes, 0x78)
    );

    await expect(
      verifyReleaseManifest({
        allowAbsentInstaller: true,
        root: setup.root
      })
    ).rejects.toThrow("Release artifact hash mismatch");
  });

  it("rejects unknown manifest fields before accepting evidence", async () => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify({ ...setup.manifest, localAbsolutePath: "C:\\private" })}\n`
    );

    await expect(
      verifyReleaseManifest({
        allowAbsentInstaller: true,
        root: setup.root
      })
    ).rejects.toThrow("Release manifest keys are not canonical");
  });
});
