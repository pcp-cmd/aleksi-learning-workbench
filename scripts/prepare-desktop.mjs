#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

const root = process.cwd();
const runtimeBuild = resolve(root, "artifacts/runtime-build/app/server.cjs");
const distDirectory = resolve(root, "dist");
const resourcesDirectory = resolve(root, "src-tauri/resources");
const sidecarDirectory = resolve(resourcesDirectory, "sidecar");
const canonicalReleaseIdentityPath = resolve(root, "release/identity.json");
const releaseIdentity = JSON.parse(
  await readFile(canonicalReleaseIdentityPath, "utf8")
);
const configuredNodeRuntime = process.env.ALEKSI_NODE_RUNTIME_PATH;
const nodeRuntimePath = resolve(
  root,
  configuredNodeRuntime === undefined || configuredNodeRuntime.trim().length === 0
    ? process.execPath
    : configuredNodeRuntime
);

function assertInsideRoot(rootPath, targetPath, label) {
  const fromRoot = relative(rootPath, targetPath);
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

async function assertNoLinkAncestors(rootPath, targetPath, label) {
  assertInsideRoot(rootPath, targetPath, label);
  const realRoot = await realpath(rootPath);
  const segments = relative(rootPath, targetPath)
    .split(sep)
    .filter((segment) => segment.length > 0);
  let current = rootPath;
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
    assertInsideRoot(
      realRoot,
      await realpath(current),
      `${label} real path`
    );
  }
  return realRoot;
}

async function assertNoLinksInTree(directory, realRoot, label) {
  try {
    await lstat(directory);
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }
    throw error;
  }
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

async function assertRegularNonLinkFile(path, label) {
  const information = await lstat(path);
  if (information.isSymbolicLink() || !information.isFile()) {
    throw new Error(`${label} must be a non-link regular file`);
  }
}

await Promise.all([
  assertRegularNonLinkFile(nodeRuntimePath, "Pinned desktop Node runtime"),
  assertRegularNonLinkFile(runtimeBuild, "Desktop sidecar build"),
  assertNoLinkAncestors(root, distDirectory, "Desktop dist directory"),
  assertNoLinkAncestors(root, resourcesDirectory, "Desktop resources directory")
]);
const realRepositoryRoot = await realpath(root);
await Promise.all([
  assertNoLinksInTree(distDirectory, realRepositoryRoot, "Desktop dist directory"),
  assertNoLinksInTree(
    resourcesDirectory,
    realRepositoryRoot,
    "Desktop resources directory"
  )
]);

const nodeBytes = await readFile(nodeRuntimePath);
const nodeSha256 = createHash("sha256").update(nodeBytes).digest("hex");
if (nodeSha256 !== releaseIdentity.nodeRuntime.sha256) {
  throw new Error(
    `Desktop Node runtime SHA-256 mismatch for ${nodeRuntimePath}. ` +
      `Expected pinned ${releaseIdentity.nodeRuntime.version} ${releaseIdentity.nodeRuntime.sha256}, got ${nodeSha256}. ` +
      "Set ALEKSI_NODE_RUNTIME_PATH to the verified official win-x64 node.exe."
  );
}
if (
  nodeBytes.length < 10 * 1024 * 1024 ||
  nodeBytes[0] !== 0x4d ||
  nodeBytes[1] !== 0x5a
) {
  throw new Error("Pinned desktop Node runtime is not a valid Windows executable");
}
const nodeVersion = execFileSync(nodeRuntimePath, ["--version"], {
  encoding: "utf8",
  windowsHide: true
}).trim();
if (nodeVersion !== releaseIdentity.nodeRuntime.version) {
  throw new Error(
    `Desktop Node runtime version is ${nodeVersion}; expected ${releaseIdentity.nodeRuntime.version}`
  );
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    const information = await lstat(absolutePath);
    if (information.isSymbolicLink()) {
      throw new Error(`Desktop content contains a symbolic link or junction: ${absolutePath}`);
    }
    if (information.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
    } else if (information.isFile()) {
      files.push(absolutePath);
    } else {
      throw new Error(`Desktop content contains a non-regular entry: ${absolutePath}`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

await assertNoLinkAncestors(
  root,
  sidecarDirectory,
  "Desktop sidecar directory"
);
await rm(sidecarDirectory, { recursive: true, force: true });
await mkdir(sidecarDirectory, { recursive: true });
await assertNoLinkAncestors(
  root,
  sidecarDirectory,
  "Desktop sidecar directory"
);

await cp(nodeRuntimePath, resolve(sidecarDirectory, "node.exe"));
await cp(runtimeBuild, resolve(sidecarDirectory, "server.cjs"));

const contentHash = createHash("sha256");
const contentFiles = [runtimeBuild, ...await collectFiles(distDirectory)];
const manifestFiles = [];
let sidecarSha256;

for (const absolutePath of contentFiles) {
  const data = await readFile(absolutePath);
  const information = await stat(absolutePath);
  const logicalPath =
    absolutePath === runtimeBuild
      ? "sidecar/server.cjs"
      : `dist/${relative(distDirectory, absolutePath).replaceAll("\\", "/")}`;
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (absolutePath === runtimeBuild) {
    sidecarSha256 = sha256;
  }
  contentHash.update(logicalPath);
  contentHash.update("\0");
  contentHash.update(data);
  manifestFiles.push({ path: logicalPath, bytes: information.size, sha256 });
}

contentHash.update("sidecar/node.exe");
contentHash.update("\0");
contentHash.update(nodeBytes);
manifestFiles.push({
  path: "sidecar/node.exe",
  bytes: nodeBytes.length,
  sha256: nodeSha256,
  source: basename(nodeRuntimePath)
});

const identity = {
  schemaVersion: releaseIdentity.projectSchemaVersion,
  product: releaseIdentity.displayName,
  version: releaseIdentity.version,
  protocolVersion: releaseIdentity.localProtocolVersion,
  shellBuildId: `desktop-${contentHash.digest("hex").slice(0, 20)}`,
  sidecarBuildId: `sidecar-${sidecarSha256.slice(0, 20)}`,
  nodeVersion,
  files: manifestFiles
};
identity.buildId = identity.shellBuildId;

await writeFile(
  resolve(resourcesDirectory, "identity.json"),
  `${JSON.stringify(identity, null, 2)}\n`,
  "utf8"
);

console.log(`Prepared desktop sidecar resources: ${sidecarDirectory}`);
console.log(`Desktop build identity: ${identity.version} ${identity.buildId}`);
