import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { open } from "node:fs/promises";
import { z } from "zod";
import { hasErrorCode } from "./error-code";

export type AssetVersion = {
  sha256: string;
  size: number;
  mtimeNs: string;
  inode: string;
};

export const assetVersionSchema = z
  .object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    size: z.number().int().nonnegative(),
    mtimeNs: z.string().regex(/^\d+$/u),
    inode: z.string().regex(/^\d+$/u)
  })
  .strict();

export type VersionedText = {
  content: string;
  modifiedAt: string;
  version: AssetVersion;
};

export class AssetVersionConflictError extends Error {
  readonly code = "ASSET_VERSION_CONFLICT";
  readonly status = 409;

  constructor(readonly relativePath: string) {
    super(
      `The asset ${relativePath} changed after it was opened; reload it before saving`
    );
    this.name = "AssetVersionConflictError";
  }
}

function versionFor(
  content: string,
  information: BigIntStats
): AssetVersion {
  return {
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    size: Number(information.size),
    mtimeNs: information.mtimeNs.toString(),
    inode: information.ino.toString()
  };
}

function sameFileSnapshot(
  left: BigIntStats,
  right: BigIntStats
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

export async function readVersionedText(
  absolutePath: string
): Promise<VersionedText> {
  const handle = await open(absolutePath, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new Error(`${absolutePath} must be a regular file`);
    }
    const content = await handle.readFile({ encoding: "utf8" });
    const after = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, after)) {
      throw new AssetVersionConflictError(absolutePath);
    }
    return {
      content,
      modifiedAt: new Date(
        Math.round(Number(after.mtimeNs) / 1_000_000)
      ).toISOString(),
      version: versionFor(content, after)
    };
  } finally {
    await handle.close();
  }
}

export async function readAssetVersion(
  absolutePath: string
): Promise<AssetVersion | null> {
  try {
    return (await readVersionedText(absolutePath)).version;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) {
      return null;
    }
    throw error;
  }
}

export function assetVersionsEqual(
  left: AssetVersion | null,
  right: AssetVersion | null
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.sha256 === right.sha256 &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.inode === right.inode;
}

export async function assertAssetVersion(
  absolutePath: string,
  relativePath: string,
  expected: AssetVersion | null
): Promise<void> {
  const current = await readAssetVersion(absolutePath);
  if (!assetVersionsEqual(current, expected)) {
    throw new AssetVersionConflictError(relativePath);
  }
}
