import { lstat, realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
  win32
} from "node:path";

export type VaultPathErrorCode =
  | "PATH_OUTSIDE_VAULT"
  | "INVALID_VAULT_RELATIVE_PATH"
  | "SYMLINK_OUTSIDE_VAULT";

export class VaultPathError extends Error {
  readonly code: VaultPathErrorCode;

  constructor(code: VaultPathErrorCode, message: string) {
    super(message);
    this.name = "VaultPathError";
    this.code = code;
  }
}

function isOutsideRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  );
}

function invalidRelativePath(message: string): never {
  throw new VaultPathError(
    "INVALID_VAULT_RELATIVE_PATH",
    `Invalid Vault-relative path: ${message}`
  );
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const INVALID_WINDOWS_SEGMENT_CHARACTERS = /[<>:"|?*]/u;
const RESERVED_WINDOWS_DEVICE =
  /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;
const WINDOWS_DRIVE_QUALIFIED_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_QUALIFIED_ABSOLUTE =
  /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u;
const WINDOWS_EXTENDED_DRIVE_QUALIFIED_ABSOLUTE =
  /^\\\\\?\\[A-Za-z]:[\\/]/u;
const WINDOWS_EXTENDED_UNC_QUALIFIED_ABSOLUTE =
  /^\\\\\?\\UNC\\[^\\/]+\\[^\\/]+(?:[\\/]|$)/iu;

export function isFullyQualifiedAbsolutePath(
  path: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (typeof path !== "string" || path.length === 0) {
    return false;
  }
  if (
    WINDOWS_DRIVE_QUALIFIED_ABSOLUTE.test(path) ||
    WINDOWS_UNC_QUALIFIED_ABSOLUTE.test(path) ||
    WINDOWS_EXTENDED_DRIVE_QUALIFIED_ABSOLUTE.test(path) ||
    WINDOWS_EXTENDED_UNC_QUALIFIED_ABSOLUTE.test(path)
  ) {
    return true;
  }

  if (platform === "win32") {
    return false;
  }

  if (path.startsWith("\\")) {
    return false;
  }
  if (path.startsWith("//")) {
    return false;
  }

  return posix.isAbsolute(path);
}

function normalizeVaultRelativeSegment(segment: string): string {
  const normalized = segment.normalize("NFC");

  if (CONTROL_CHARACTERS.test(normalized)) {
    return invalidRelativePath("control characters are forbidden");
  }
  if (INVALID_WINDOWS_SEGMENT_CHARACTERS.test(normalized)) {
    return invalidRelativePath(
      'Windows-invalid characters < > : " | ? * are forbidden'
    );
  }
  if (/[ .]$/u.test(normalized)) {
    return invalidRelativePath(
      "segments must not end with a dot or space"
    );
  }

  const deviceStem = (normalized.split(".", 1)[0] ?? "").trimEnd();
  if (RESERVED_WINDOWS_DEVICE.test(deviceStem)) {
    return invalidRelativePath(
      "Windows reserved device names are forbidden"
    );
  }

  return normalized;
}

export function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(root, candidate);

  if (isOutsideRoot(resolvedRoot, resolvedCandidate)) {
    throw new VaultPathError(
      "PATH_OUTSIDE_VAULT",
      "Resolved path is outside the Vault root"
    );
  }

  return resolvedCandidate;
}

export function normalizeVaultRelativePath(relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return invalidRelativePath("path must be a nonempty string");
  }
  if (relativePath.includes("\0")) {
    return invalidRelativePath("NUL is forbidden");
  }
  if (/%(?:2f|5c)/iu.test(relativePath)) {
    return invalidRelativePath("encoded separators are forbidden");
  }
  if (relativePath.includes("\\")) {
    return invalidRelativePath("backslashes are forbidden");
  }
  if (
    relativePath.startsWith("/") ||
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    /^[A-Za-z]:/u.test(relativePath)
  ) {
    return invalidRelativePath("absolute paths are forbidden");
  }

  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    return invalidRelativePath("empty, dot, and dot-dot segments are forbidden");
  }

  return segments.map(normalizeVaultRelativeSegment).join("/");
}

export function resolveInsideRoot(root: string, ...segments: string[]): string {
  if (segments.length === 0) {
    return resolve(root);
  }

  const relativePath = segments
    .map((segment) => normalizeVaultRelativePath(segment))
    .join("/");
  const normalized = normalizeVaultRelativePath(relativePath);
  return assertInsideRoot(root, resolve(root, ...normalized.split("/")));
}

async function nearestExistingPath(candidate: string): Promise<{
  path: string;
  isSymbolicLink: boolean;
}> {
  let current = candidate;

  for (;;) {
    try {
      const information = await lstat(current);
      return {
        path: current,
        isSymbolicLink: information.isSymbolicLink()
      };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }

      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      current = parent;
    }
  }
}

export async function assertRealPathInsideRoot(
  root: string,
  candidateParentOrExistingPath: string
): Promise<string> {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = assertInsideRoot(
    resolvedRoot,
    candidateParentOrExistingPath
  );
  const realRoot = await realpath(resolvedRoot);
  const nearest = await nearestExistingPath(resolvedCandidate);
  let realNearest: string;

  try {
    realNearest = await realpath(nearest.path);
  } catch (error) {
    if (nearest.isSymbolicLink) {
      throw new VaultPathError(
        "SYMLINK_OUTSIDE_VAULT",
        "A symlink or junction does not resolve safely inside the Vault"
      );
    }
    throw error;
  }

  if (isOutsideRoot(realRoot, realNearest)) {
    throw new VaultPathError(
      "SYMLINK_OUTSIDE_VAULT",
      "A symlink or junction resolves outside the Vault"
    );
  }

  return resolvedCandidate;
}

export async function isSameOrNestedRealPath(
  root: string,
  candidateParentOrExistingPath: string
): Promise<boolean> {
  const realRoot = await realpath(resolve(root));
  const nearest = await nearestExistingPath(
    resolve(candidateParentOrExistingPath)
  );
  const realNearest = await realpath(nearest.path);

  return !isOutsideRoot(realRoot, realNearest);
}
