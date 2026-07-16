#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const root = process.cwd();
const runtimeBuild = resolve(root, "artifacts/runtime-build/app/server.js");
const distDirectory = resolve(root, "dist");
const resourcesDirectory = resolve(root, "src-tauri/resources");
const sidecarDirectory = resolve(resourcesDirectory, "sidecar");
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8")
);

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

await rm(sidecarDirectory, { recursive: true, force: true });
await mkdir(sidecarDirectory, { recursive: true });

await cp(process.execPath, resolve(sidecarDirectory, "node.exe"));
await cp(runtimeBuild, resolve(sidecarDirectory, "server.js"));

const contentHash = createHash("sha256");
const contentFiles = [runtimeBuild, ...await collectFiles(distDirectory)];
const manifestFiles = [];

for (const absolutePath of contentFiles) {
  const data = await readFile(absolutePath);
  const information = await stat(absolutePath);
  const logicalPath =
    absolutePath === runtimeBuild
      ? "sidecar/server.js"
      : `dist/${relative(distDirectory, absolutePath).replaceAll("\\", "/")}`;
  const sha256 = createHash("sha256").update(data).digest("hex");
  contentHash.update(logicalPath);
  contentHash.update("\0");
  contentHash.update(data);
  manifestFiles.push({ path: logicalPath, bytes: information.size, sha256 });
}

const nodeBytes = await readFile(process.execPath);
contentHash.update("sidecar/node.exe");
contentHash.update("\0");
contentHash.update(nodeBytes);
manifestFiles.push({
  path: "sidecar/node.exe",
  bytes: nodeBytes.length,
  sha256: createHash("sha256").update(nodeBytes).digest("hex"),
  source: basename(process.execPath)
});

const identity = {
  schemaVersion: 1,
  product: "Aleksi Workbench Desktop",
  version: packageJson.version,
  buildId: `desktop-${contentHash.digest("hex").slice(0, 20)}`,
  nodeVersion: process.version,
  files: manifestFiles
};

await writeFile(
  resolve(resourcesDirectory, "identity.json"),
  `${JSON.stringify(identity, null, 2)}\n`,
  "utf8"
);

console.log(`Prepared desktop sidecar resources: ${sidecarDirectory}`);
console.log(`Desktop build identity: ${identity.version} ${identity.buildId}`);
