import { constants } from "node:fs";
import type { Stats } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { isWellFormedString } from "../domain/schemas";
import { hasErrorCode } from "./error-code";
import {
  assertInsideRoot,
  assertRealPathInsideRoot
} from "./path-safety";

export interface AtomicFileHandle {
  writeFile(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicWriteFileSystem {
  open(path: string, flags: string): Promise<AtomicFileHandle>;
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  copyFile(source: string, destination: string, mode: number): Promise<void>;
  link(source: string, destination: string): Promise<void>;
  lstat(path: string): Promise<Stats>;
  rename(source: string, destination: string): Promise<void>;
  stat(path: string): Promise<Stats>;
  unlink(path: string): Promise<void>;
}

export interface AtomicWriteOptions {
  root: string;
  fileSystem?: Partial<AtomicWriteFileSystem>;
}

export interface AtomicWriteReceipt {
  path: string;
  modifiedAt: string;
}

export class AtomicWriteError extends Error {
  readonly code: "INVALID_TEXT_CONTENT";

  constructor(message: string) {
    super(message);
    this.name = "AtomicWriteError";
    this.code = "INVALID_TEXT_CONTENT";
  }
}

const DEFAULT_FILE_SYSTEM: AtomicWriteFileSystem = {
  open: async (path, flags) => open(path, flags),
  mkdir: async (path, options) => mkdir(path, options),
  copyFile: async (source, destination, mode) =>
    copyFile(source, destination, mode),
  link: async (source, destination) => link(source, destination),
  lstat: async (path) => lstat(path),
  rename: async (source, destination) => rename(source, destination),
  stat: async (path) => stat(path),
  unlink: async (path) => unlink(path)
};

function fileSystemFor(
  options: AtomicWriteOptions
): AtomicWriteFileSystem {
  return {
    ...DEFAULT_FILE_SYSTEM,
    ...options.fileSystem
  };
}

function validateContent(content: string): Uint8Array {
  if (typeof content !== "string" || !isWellFormedString(content)) {
    throw new AtomicWriteError(
      "Atomic text writes require a well-formed string"
    );
  }
  return Buffer.from(content, "utf8");
}

function siblingArtifactPath(target: string, extension: "tmp" | "bak"): string {
  return join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomBytes(12).toString("hex")}.${extension}`
  );
}

async function safeUnlink(
  fileSystem: AtomicWriteFileSystem,
  path: string | undefined
): Promise<void> {
  if (path === undefined) {
    return;
  }
  await fileSystem.unlink(path).catch(() => undefined);
}

async function prepareTarget(
  target: string,
  options: AtomicWriteOptions,
  fileSystem: AtomicWriteFileSystem
): Promise<string> {
  const safeTarget = assertInsideRoot(options.root, target);
  const parent = dirname(safeTarget);

  await assertRealPathInsideRoot(options.root, parent);
  await fileSystem.mkdir(parent, { recursive: true });
  await assertRealPathInsideRoot(options.root, parent);
  await assertRealPathInsideRoot(options.root, safeTarget);

  return safeTarget;
}

async function writeDurableTemporaryFile(
  target: string,
  bytes: Uint8Array,
  fileSystem: AtomicWriteFileSystem
): Promise<string> {
  for (;;) {
    const temporaryPath = siblingArtifactPath(target, "tmp");
    let handle: AtomicFileHandle | undefined;
    let closed = false;

    try {
      handle = await fileSystem.open(temporaryPath, "wx");
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      closed = true;
      return temporaryPath;
    } catch (error) {
      if (handle !== undefined && !closed) {
        await handle.close().catch(() => undefined);
      }
      await safeUnlink(fileSystem, temporaryPath);

      if (handle === undefined && hasErrorCode(error, "EEXIST")) {
        continue;
      }
      throw error;
    }
  }
}

async function createDurableBackup(
  target: string,
  fileSystem: AtomicWriteFileSystem
): Promise<string> {
  for (;;) {
    const backupPath = siblingArtifactPath(target, "bak");
    try {
      await fileSystem.copyFile(
        target,
        backupPath,
        constants.COPYFILE_EXCL
      );
      const handle = await fileSystem.open(backupPath, "r+");
      try {
        await handle.sync();
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await safeUnlink(fileSystem, backupPath);
        throw error;
      }
      return backupPath;
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        continue;
      }
      await safeUnlink(fileSystem, backupPath);
      throw error;
    }
  }
}

async function restoreBackupAndReleaseOwnership(
  target: string,
  backupPath: string,
  fileSystem: AtomicWriteFileSystem,
  releaseBackup: () => void
): Promise<void> {
  releaseBackup();
  await restoreBackup(target, backupPath, fileSystem);
}

async function restoreBackup(
  target: string,
  backupPath: string,
  fileSystem: AtomicWriteFileSystem
): Promise<void> {
  await safeUnlink(fileSystem, target);
  await fileSystem.rename(backupPath, target);
}

async function receiptFor(
  target: string,
  fileSystem: AtomicWriteFileSystem
): Promise<AtomicWriteReceipt> {
  const information = await fileSystem.stat(target);
  return {
    path: await realpath(target),
    modifiedAt: information.mtime.toISOString()
  };
}

async function targetExists(
  target: string,
  fileSystem: AtomicWriteFileSystem
): Promise<boolean> {
  try {
    await fileSystem.lstat(target);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

export async function atomicCreateText(
  target: string,
  content: string,
  options: AtomicWriteOptions
): Promise<AtomicWriteReceipt> {
  const bytes = validateContent(content);
  const fileSystem = fileSystemFor(options);
  const safeTarget = await prepareTarget(target, options, fileSystem);
  let temporaryPath = await writeDurableTemporaryFile(
    safeTarget,
    bytes,
    fileSystem
  );
  let targetCreated = false;

  try {
    await fileSystem.link(temporaryPath, safeTarget);
    targetCreated = true;
    await safeUnlink(fileSystem, temporaryPath);
    temporaryPath = "";
    return await receiptFor(safeTarget, fileSystem);
  } catch (error) {
    if (targetCreated) {
      await safeUnlink(fileSystem, safeTarget);
    }
    throw error;
  } finally {
    await safeUnlink(fileSystem, temporaryPath || undefined);
  }
}

export async function atomicWriteText(
  target: string,
  content: string,
  options: AtomicWriteOptions
): Promise<AtomicWriteReceipt> {
  const bytes = validateContent(content);
  const fileSystem = fileSystemFor(options);
  const safeTarget = await prepareTarget(target, options, fileSystem);
  let temporaryPath = await writeDurableTemporaryFile(
    safeTarget,
    bytes,
    fileSystem
  );
  let backupPath: string | undefined;

  try {
    if (!(await targetExists(safeTarget, fileSystem))) {
      await fileSystem.rename(temporaryPath, safeTarget);
      temporaryPath = "";
      try {
        return await receiptFor(safeTarget, fileSystem);
      } catch (error) {
        await safeUnlink(fileSystem, safeTarget);
        throw error;
      }
    }

    backupPath = await createDurableBackup(safeTarget, fileSystem);

    try {
      await fileSystem.rename(temporaryPath, safeTarget);
      temporaryPath = "";
    } catch (error) {
      if (!hasErrorCode(error, "EACCES", "EEXIST", "ENOTEMPTY", "EPERM")) {
        throw error;
      }

      await fileSystem.unlink(safeTarget);
      try {
        await fileSystem.rename(temporaryPath, safeTarget);
        temporaryPath = "";
      } catch (replacementError) {
        await restoreBackupAndReleaseOwnership(
          safeTarget,
          backupPath,
          fileSystem,
          () => {
            backupPath = undefined;
          }
        );
        throw replacementError;
      }
    }

    try {
      const receipt = await receiptFor(safeTarget, fileSystem);
      await safeUnlink(fileSystem, backupPath);
      backupPath = undefined;
      return receipt;
    } catch (error) {
      const currentBackup = backupPath;
      if (currentBackup === undefined) {
        throw error;
      }
      await restoreBackupAndReleaseOwnership(
        safeTarget,
        currentBackup,
        fileSystem,
        () => {
          backupPath = undefined;
        }
      );
      throw error;
    }
  } finally {
    await safeUnlink(fileSystem, temporaryPath || undefined);
    await safeUnlink(fileSystem, backupPath);
  }
}
