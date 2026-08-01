import { homedir } from "node:os";
import { lstat, mkdir, stat } from "node:fs/promises";
import {
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep
} from "node:path";
import { normalizeUserSuppliedVaultPath } from "../../shared/user-path";
import { hasErrorCode } from "../lib/error-code";
import {
  isFullyQualifiedAbsolutePath,
  isSameOrNestedRealPath
} from "../lib/path-safety";

export type VaultServiceErrorCode =
  | "ACTIVE_VAULT_NOT_CONFIGURED"
  | "BACKUP_EXPORT_REQUIRED"
  | "BACKUP_NOT_DISCOVERED"
  | "BACKUP_RETENTION_CLEANUP_FAILED"
  | "DESTINATION_NOT_EMPTY"
  | "HASH_VERIFICATION_FAILED"
  | "INVALID_ABSOLUTE_PATH"
  | "INVALID_FILESYSTEM_ENTRY"
  | "INVALID_VAULT_SETTINGS"
  | "PATH_AMBIGUOUS"
  | "SOURCE_DESTINATION_CONFLICT"
  | "VAULT_NOT_INITIALIZED";

export class VaultServiceError extends Error {
  readonly code: VaultServiceErrorCode;
  readonly status: number;

  constructor(
    code: VaultServiceErrorCode,
    message: string,
    status = 400
  ) {
    super(message);
    this.name = "VaultServiceError";
    this.code = code;
    this.status = status;
  }
}

export function defaultLearningLibraryPath(): string {
  return resolve(
    process.env.ALEKSI_DEFAULT_VAULT_PATH ??
      join(homedir(), "Documents", "Aleksi Learning Workbench")
  );
}

const INVALID_VAULT_PATH_MESSAGE =
  `学习库位置必须是完整路径，例如：\n${defaultLearningLibraryPath()}`;

function hasDotSegment(path: string): boolean {
  return path
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0)
    .some((segment) => segment === "." || segment === "..");
}

export function resolvePrivilegedAbsolutePath(path: string): string {
  if (typeof path !== "string") {
    throw new VaultServiceError(
      "INVALID_ABSOLUTE_PATH",
      INVALID_VAULT_PATH_MESSAGE
    );
  }
  const normalizedPath = normalizeUserSuppliedVaultPath(path);
  if (
    normalizedPath.length === 0 ||
    normalizedPath.includes("\0") ||
    /%(?:2f|5c)/iu.test(normalizedPath) ||
    hasDotSegment(normalizedPath) ||
    !isFullyQualifiedAbsolutePath(normalizedPath)
  ) {
    throw new VaultServiceError(
      "INVALID_ABSOLUTE_PATH",
      INVALID_VAULT_PATH_MESSAGE
    );
  }
  return resolve(normalizedPath);
}

function isInsideOrSame(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

export async function assertVaultPathsDoNotOverlap(
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  if (
    isInsideOrSame(sourcePath, destinationPath) ||
    isInsideOrSame(destinationPath, sourcePath) ||
    (await isSameOrNestedRealPath(sourcePath, destinationPath)) ||
    ((await pathExists(destinationPath)) &&
      (await isSameOrNestedRealPath(destinationPath, sourcePath)))
  ) {
    throw new VaultServiceError(
      "SOURCE_DESTINATION_CONFLICT",
      "Source and destination must not overlap",
      409
    );
  }
}

export async function assertNoExistingSymlinkInPath(
  path: string
): Promise<void> {
  const resolvedPath = resolve(path);
  const root = parse(resolvedPath).root;
  const segments = relative(root, resolvedPath)
    .split(sep)
    .filter((segment) => segment.length > 0);
  let current = root;

  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    try {
      const information = await lstat(current);
      if (information.isSymbolicLink()) {
        throw new VaultServiceError(
          "PATH_AMBIGUOUS",
          "Vault path must not pass through a symlink or junction"
        );
      }
      if (!information.isDirectory() && index < segments.length - 1) {
        throw new VaultServiceError(
          "INVALID_FILESYSTEM_ENTRY",
          "Vault path ancestor is not a directory"
        );
      }
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  await assertNoExistingSymlinkInPath(path);
  await mkdir(path, { recursive: true });
  await assertNoExistingSymlinkInPath(path);
  const information = await stat(path);
  if (!information.isDirectory()) {
    throw new VaultServiceError(
      "INVALID_FILESYSTEM_ENTRY",
      "Expected a directory"
    );
  }
}
