#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_SCHEMA_PATH = "release/release-manifest.schema.json";
const RELEASE_IDENTITY_PATH = "release/identity.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeRelativePath(path) {
  return String(path).replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function assertSafeRelativePath(path, label) {
  assert(typeof path === "string" && path.length > 0, `${label} must be a path`);
  assert(!isAbsolute(path), `${label} must not be absolute`);
  const normalized = normalizeRelativePath(path);
  assert(
    !normalized.split("/").includes(".."),
    `${label} must not leave the release directory`
  );
  assert(normalized === path, `${label} must use normalized forward slashes`);
  return normalized;
}

function assertInsideRoot(root, target, label) {
  const rootPrefix = `${root}${sep}`;
  assert(
    target === root || target.startsWith(rootPrefix),
    `${label} leaves the expected root`
  );
}

function assertExactKeys(value, expected, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`
  );
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(canonical),
    `${label} keys are not canonical`
  );
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function collectRegularFiles(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    assertInsideRoot(base, absolutePath, "Release artifact");
    const information = await lstat(absolutePath);
    assert(!information.isSymbolicLink(), "Release evidence must not contain links");
    if (information.isDirectory()) {
      files.push(...await collectRegularFiles(absolutePath, base));
    } else if (information.isFile()) {
      files.push(normalizeRelativePath(relative(base, absolutePath)));
    } else {
      throw new Error(`Unsupported release artifact type: ${entry.name}`);
    }
  }
  return files.sort();
}

function parseArguments(argv) {
  const options = {
    allowAbsentInstaller: false,
    allowDirty: false,
    manifestPath: null,
    root: process.cwd()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-absent-installer") {
      options.allowAbsentInstaller = true;
    } else if (argument === "--allow-dirty") {
      options.allowDirty = true;
    } else if (argument === "--manifest" || argument === "--root") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a path`);
      }
      if (argument === "--manifest") {
        options.manifestPath = value;
      } else {
        options.root = value;
      }
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

export async function verifyReleaseManifest(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const [identity, schema] = await Promise.all([
    readFile(resolve(root, RELEASE_IDENTITY_PATH), "utf8").then(JSON.parse),
    readFile(resolve(root, MANIFEST_SCHEMA_PATH), "utf8").then(JSON.parse)
  ]);
  assert(schema.additionalProperties === false, "Release manifest schema must be strict");
  assertExactKeys(
    schema.properties,
    schema.required,
    "Release manifest schema properties"
  );

  const defaultManifestPath = resolve(
    root,
    identity.releaseDirectory,
    "release-manifest.json"
  );
  const manifestPath = resolve(
    root,
    options.manifestPath ?? defaultManifestPath
  );
  assertInsideRoot(root, manifestPath, "Release manifest");
  const releaseDirectory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assertExactKeys(manifest, schema.required, "Release manifest");
  assert(manifest.schemaVersion === 3, "Release manifest schemaVersion must be 3");
  assert(manifest.packageType === "tauri-nsis", "Unexpected packageType");
  assert(manifest.version === identity.version, "Release manifest version drift");
  assert(manifest.identifier === identity.identifier, "Release identifier drift");
  assert(COMMIT_PATTERN.test(manifest.commit), "Release commit must be a full Git SHA");
  assert(
    options.allowDirty === true || manifest.dirty === false,
    "Qualified release manifest must come from a clean source tree"
  );
  assert(
    manifest.signingStatus === identity.signing.status,
    "Release signing status drift"
  );
  assert(
    JSON.stringify(manifest.webView2) === JSON.stringify(identity.webView2),
    "Release WebView2 policy drift"
  );
  assert(
    manifest.artifactHashAlgorithm === "SHA-256",
    "Release artifact hash algorithm must be SHA-256"
  );

  const expectedSigning =
    identity.signing.status === "signed-release"
      ? { authenticodeStatus: "Valid", signed: true }
      : { authenticodeStatus: "NotSigned", signed: false };
  assert(
    manifest.signed === expectedSigning.signed,
    "Release signed flag does not match signing policy"
  );

  assert(Array.isArray(manifest.artifacts), "Release artifacts must be an array");
  const artifactPaths = new Set();
  for (const artifact of manifest.artifacts) {
    assertExactKeys(artifact, ["bytes", "path", "sha256"], "Release artifact");
    const artifactPath = assertSafeRelativePath(
      artifact.path,
      "Release artifact path"
    );
    assert(!artifactPaths.has(artifactPath), `Duplicate release artifact: ${artifactPath}`);
    artifactPaths.add(artifactPath);
    assert(
      Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0,
      `Invalid artifact byte count: ${artifactPath}`
    );
    assert(
      SHA256_PATTERN.test(artifact.sha256),
      `Invalid artifact hash: ${artifactPath}`
    );
    const absolutePath = resolve(releaseDirectory, ...artifactPath.split("/"));
    assertInsideRoot(releaseDirectory, absolutePath, "Release artifact");
    const data = await readFile(absolutePath);
    assert(data.length === artifact.bytes, `Artifact byte mismatch: ${artifactPath}`);
    assert(
      sha256(data) === artifact.sha256,
      `Release artifact hash mismatch: ${artifactPath}`
    );
  }

  const actualFiles = (await collectRegularFiles(releaseDirectory))
    .filter((path) => path !== "release-manifest.json");
  assert(
    JSON.stringify(actualFiles) === JSON.stringify([...artifactPaths].sort()),
    "Release artifact inventory does not match the evidence directory"
  );

  if (manifest.installerStatus === "present") {
    assert(manifest.installer !== null, "Present installer must have metadata");
    assert(
      manifest.installer.path === identity.installerFilename,
      "Installer filename drift"
    );
    assert(
      manifest.installer.authenticodeStatus ===
        expectedSigning.authenticodeStatus,
      "Installer Authenticode status does not match signing policy"
    );
    const artifact = manifest.artifacts.find(
      (entry) => entry.path === manifest.installer.path
    );
    assert(artifact !== undefined, "Installer is absent from artifact inventory");
    assert(
      artifact.bytes === manifest.installer.bytes &&
        artifact.sha256 === manifest.installer.sha256,
      "Installer metadata does not match artifact inventory"
    );
  } else {
    assert(manifest.installerStatus === "absent", "Unknown installer status");
    assert(manifest.installer === null, "Absent installer metadata must be null");
    assert(
      options.allowAbsentInstaller === true,
      "Qualified release manifest must include an installer"
    );
  }

  return { identity, manifest, manifestPath, releaseDirectory };
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyReleaseManifest(parseArguments(process.argv.slice(2)));
    console.log(
      `Release manifest verified: ${result.manifest.version} (${result.manifest.artifacts.length} artifact hashes)`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
