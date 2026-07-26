import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { assertRealPathInsideRoot } from "./path-safety";

const READ_CHUNK_BYTES = 64 * 1024;

export type RegularFileVersion = {
  device: bigint;
  inode: bigint;
  size: bigint;
  modifiedNanoseconds: bigint;
  changedNanoseconds: bigint;
  sha256: string;
};

export type BoundedRegularFile = {
  data: Buffer;
  version: RegularFileVersion;
};

export class BoundedRegularFileError extends Error {
  readonly code: "FILE_TOO_LARGE" | "INVALID_REGULAR_FILE";

  constructor(
    code: BoundedRegularFileError["code"],
    message: string
  ) {
    super(message);
    this.name = "BoundedRegularFileError";
    this.code = code;
  }
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  if (left.ino === 0n || right.ino === 0n) {
    return false;
  }
  return process.platform === "win32"
    ? left.ino === right.ino
    : left.dev === right.dev && left.ino === right.ino;
}

function sameFileMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function invalidRegularFile(label: string): BoundedRegularFileError {
  return new BoundedRegularFileError(
    "INVALID_REGULAR_FILE",
    `${label} must remain one regular, non-symlink file while it is read`
  );
}

function fileTooLarge(
  label: string,
  maxBytes: number
): BoundedRegularFileError {
  return new BoundedRegularFileError(
    "FILE_TOO_LARGE",
    `${label} exceeds the ${maxBytes} byte limit`
  );
}

function assertBoundedSize(
  information: BigIntStats,
  maxBytes: number,
  label: string
): void {
  if (information.size > BigInt(maxBytes)) {
    throw fileTooLarge(label, maxBytes);
  }
}

function versionFrom(
  information: BigIntStats,
  data: Buffer
): RegularFileVersion {
  return {
    device: information.dev,
    inode: information.ino,
    size: information.size,
    modifiedNanoseconds: information.mtimeNs,
    changedNanoseconds: information.ctimeNs,
    sha256: createHash("sha256").update(data).digest("hex")
  };
}

export function sameRegularFileVersion(
  left: RegularFileVersion,
  right: RegularFileVersion
): boolean {
  const sameIdentity =
    left.inode !== 0n &&
    right.inode !== 0n &&
    (process.platform === "win32"
      ? left.inode === right.inode
      : left.device === right.device && left.inode === right.inode);

  return (
    sameIdentity &&
    left.size === right.size &&
    left.modifiedNanoseconds === right.modifiedNanoseconds &&
    left.changedNanoseconds === right.changedNanoseconds &&
    left.sha256 === right.sha256
  );
}

export async function readBoundedRegularFile(
  root: string,
  absolutePath: string,
  options: {
    maxBytes: number;
    label: string;
  }
): Promise<BoundedRegularFile> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }

  const initialInformation = await lstat(absolutePath, { bigint: true });
  if (
    !initialInformation.isFile() ||
    initialInformation.isSymbolicLink()
  ) {
    throw invalidRegularFile(options.label);
  }
  assertBoundedSize(initialInformation, options.maxBytes, options.label);
  await assertRealPathInsideRoot(root, absolutePath);

  const noFollowFlag = constants.O_NOFOLLOW ?? 0;
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | noFollowFlag
  );
  try {
    const openedInformation = await handle.stat({ bigint: true });
    const currentPathInformation = await lstat(absolutePath, {
      bigint: true
    });
    await assertRealPathInsideRoot(root, absolutePath);

    if (
      !openedInformation.isFile() ||
      !currentPathInformation.isFile() ||
      currentPathInformation.isSymbolicLink() ||
      !sameFileMetadata(initialInformation, openedInformation) ||
      !sameFileMetadata(openedInformation, currentPathInformation)
    ) {
      throw invalidRegularFile(options.label);
    }
    assertBoundedSize(openedInformation, options.maxBytes, options.label);

    const expectedBytes = Number(openedInformation.size);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= expectedBytes) {
      const remaining = expectedBytes + 1 - totalBytes;
      if (remaining === 0) {
        break;
      }
      const chunk = Buffer.allocUnsafe(
        Math.min(READ_CHUNK_BYTES, remaining)
      );
      const { bytesRead } = await handle.read(
        chunk,
        0,
        chunk.length,
        null
      );
      if (bytesRead === 0) {
        break;
      }
      chunks.push(chunk.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }

    const finalOpenedInformation = await handle.stat({ bigint: true });
    const finalPathInformation = await lstat(absolutePath, {
      bigint: true
    });
    await assertRealPathInsideRoot(root, absolutePath);

    if (
      totalBytes !== expectedBytes ||
      !sameFileMetadata(openedInformation, finalOpenedInformation) ||
      !sameFileMetadata(finalOpenedInformation, finalPathInformation)
    ) {
      throw invalidRegularFile(options.label);
    }

    const data = Buffer.concat(chunks, totalBytes);
    return {
      data,
      version: versionFrom(finalOpenedInformation, data)
    };
  } finally {
    await handle.close();
  }
}
