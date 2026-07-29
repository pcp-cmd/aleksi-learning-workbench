import { constants, createReadStream } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  opendir,
  rename,
  rmdir,
  rm,
  stat
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep
} from "node:path";
import { z } from "zod";
import {
  DEFAULT_VAULT_DIRECTORIES,
  LEGACY_REVIEW_DIRECTORY,
  REVIEW_DIRECTORY
} from "../../shared/vault-map";
import { normalizeUserSuppliedVaultPath } from "../../shared/user-path";
import {
  readAppSettings,
  writeAppSettings
} from "../config/app-settings";
import {
  parseVaultTransferManifest,
  vaultTransferManifestSchema,
  type FileDigest,
  type VaultTransferManifest
} from "./vault-transfer-schema";
import { atomicCreateText, atomicWriteText } from "../lib/atomic-write";
import { readBoundedRegularFile } from "../lib/bounded-regular-file";
import { hasErrorCode } from "../lib/error-code";
import { IoBudget } from "../lib/io-budget";
import type { FaultController } from "../testing/fault-controller";
import {
  assertInsideRoot,
  isFullyQualifiedAbsolutePath,
  isSameOrNestedRealPath,
  resolveInsideRoot
} from "../lib/path-safety";

export type VaultStatus = {
  path: string;
  initialized: boolean;
  writable: boolean;
  readOnlyReason: string | null;
  lastSaveAt: string | null;
};

export const VAULT_IO_LIMITS = {
  maxDepth: 64,
  maxFiles: 100_000,
  maxFileBytes: 4 * 1024 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024 * 1024,
  maxConcurrency: 8
} as const;

export function createVaultIoBudget(): IoBudget {
  return new IoBudget({
    ...VAULT_IO_LIMITS,
    deadlineAt: Date.now() + 30 * 60 * 1000
  });
}

type VaultServiceErrorCode =
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

const VAULT_FOLDERS = DEFAULT_VAULT_DIRECTORIES;
const REQUIRED_EXISTING_VAULT_FOLDERS = VAULT_FOLDERS.filter(
  (folder) => folder !== REVIEW_DIRECTORY
);

const ALEKSI_JSON_FILES = [
  "index.json",
  "review-queue.json",
  "graph-state.json",
  "settings.json"
] as const;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const INVALID_VAULT_PATH_MESSAGE =
  `学习库位置必须是完整路径，例如：\n${defaultLearningLibraryPath()}`;

const vaultSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    vaultId: z.string().regex(UUID_V4)
  })
  .strict();

type VaultSettings = z.infer<typeof vaultSettingsSchema>;

const MIGRATION_MANIFEST_PATH = ".aleksi/migration-manifest.json";
const MAX_TRANSFER_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_VAULT_SETTINGS_BYTES = 64 * 1024;

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

  if (normalizedPath.length === 0) {
    throw new VaultServiceError(
      "INVALID_ABSOLUTE_PATH",
      INVALID_VAULT_PATH_MESSAGE
    );
  }
  if (normalizedPath.includes("\0")) {
    throw new VaultServiceError(
      "INVALID_ABSOLUTE_PATH",
      INVALID_VAULT_PATH_MESSAGE
    );
  }
  if (/%(?:2f|5c)/iu.test(normalizedPath)) {
    throw new VaultServiceError(
      "INVALID_ABSOLUTE_PATH",
      INVALID_VAULT_PATH_MESSAGE
    );
  }
  if (hasDotSegment(normalizedPath)) {
    throw new VaultServiceError(
      "INVALID_ABSOLUTE_PATH",
      INVALID_VAULT_PATH_MESSAGE
    );
  }
  if (!isFullyQualifiedAbsolutePath(normalizedPath)) {
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

async function pathExists(path: string): Promise<boolean> {
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

async function directoryExists(path: string): Promise<boolean> {
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

async function ensureDirectory(path: string): Promise<void> {
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

function parseVaultSettings(raw: string): VaultSettings {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VaultServiceError(
      "INVALID_VAULT_SETTINGS",
      error instanceof Error
        ? `Vault settings are invalid JSON: ${error.message}`
        : "Vault settings are invalid JSON"
    );
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Object.keys(parsed).join("|") !== "schemaVersion|vaultId"
  ) {
    throw new VaultServiceError(
      "INVALID_VAULT_SETTINGS",
      "Vault settings must contain exactly schemaVersion and vaultId"
    );
  }

  try {
    return vaultSettingsSchema.parse(parsed);
  } catch (error) {
    throw new VaultServiceError(
      "INVALID_VAULT_SETTINGS",
      error instanceof Error
        ? `Vault settings are invalid: ${error.message}`
        : "Vault settings are invalid"
    );
  }
}

async function readVaultSettingsIfPresent(
  vaultPath: string
): Promise<VaultSettings | null> {
  const settingsPath = resolveInsideRoot(vaultPath, ".aleksi/settings.json");

  try {
    return parseVaultSettings(
      (
        await readBoundedRegularFile(vaultPath, settingsPath, {
          maxBytes: MAX_VAULT_SETTINGS_BYTES,
          label: "Vault settings"
        })
      ).data.toString("utf8")
    );
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

export async function readVaultId(vaultPath: string): Promise<string> {
  const settings = await readVaultSettingsIfPresent(vaultPath);
  if (settings === null) {
    throw new VaultServiceError(
      "VAULT_NOT_INITIALIZED",
      "Vault identity is missing"
    );
  }
  return settings.vaultId;
}

function vaultSettingsText(settings: VaultSettings): string {
  return `${JSON.stringify(
    {
      schemaVersion: settings.schemaVersion,
      vaultId: settings.vaultId
    },
    null,
    2
  )}\n`;
}

async function createTextIfMissing(
  vaultPath: string,
  relativePath: string,
  content: string
): Promise<void> {
  const targetPath = resolveInsideRoot(vaultPath, relativePath);

  try {
    await atomicCreateText(targetPath, content, { root: vaultPath });
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      return;
    }
    throw error;
  }
}

function generatedAt(): string {
  return new Date().toISOString();
}

function emptyIndexJson(): string {
  return `${JSON.stringify(
    {
      generatedAt: generatedAt(),
      sourceFingerprint: "0".repeat(64),
      assets: [],
      parseErrors: []
    },
    null,
    2
  )}\n`;
}

function emptyReviewQueueJson(): string {
  return `${JSON.stringify(
    {
      generatedAt: generatedAt(),
      sourceIndexFingerprint: "0".repeat(64),
      items: []
    },
    null,
    2
  )}\n`;
}

function emptyGraphStateJson(): string {
  return `${JSON.stringify(
    {
      generatedAt: generatedAt(),
      sourceIndexFingerprint: "0".repeat(64),
      concepts: {}
    },
    null,
    2
  )}\n`;
}

async function ensureVaultIdentity(vaultPath: string): Promise<void> {
  const existingSettings = await readVaultSettingsIfPresent(vaultPath);
  if (existingSettings !== null) {
    return;
  }

  await createTextIfMissing(
    vaultPath,
    ".aleksi/settings.json",
    vaultSettingsText({
      schemaVersion: 1,
      vaultId: randomUUID()
    })
  );
}

async function ensureProjectionFiles(vaultPath: string): Promise<void> {
  await createTextIfMissing(vaultPath, ".aleksi/index.json", emptyIndexJson());
  await createTextIfMissing(
    vaultPath,
    ".aleksi/review-queue.json",
    emptyReviewQueueJson()
  );
  await createTextIfMissing(
    vaultPath,
    ".aleksi/graph-state.json",
    emptyGraphStateJson()
  );
}

async function ensureVaultFolders(vaultPath: string): Promise<void> {
  await ensureDirectory(vaultPath);
  for (const folder of VAULT_FOLDERS) {
    await ensureDirectory(resolveInsideRoot(vaultPath, folder));
  }
}

async function scaffoldVault(vaultPath: string): Promise<void> {
  await ensureVaultFolders(vaultPath);
  await ensureVaultIdentity(vaultPath);
  await ensureProjectionFiles(vaultPath);
}

async function isInitializedVault(vaultPath: string): Promise<boolean> {
  try {
    await assertNoExistingSymlinkInPath(vaultPath);
    const rootInformation = await stat(vaultPath);
    if (!rootInformation.isDirectory()) {
      return false;
    }

    for (const folder of REQUIRED_EXISTING_VAULT_FOLDERS) {
      const information = await stat(resolveInsideRoot(vaultPath, folder));
      if (!information.isDirectory()) {
        return false;
      }
    }

    if (
      !(await directoryExists(resolveInsideRoot(vaultPath, REVIEW_DIRECTORY))) &&
      !(await directoryExists(
        resolveInsideRoot(vaultPath, LEGACY_REVIEW_DIRECTORY)
      ))
    ) {
      return false;
    }

    for (const filename of ALEKSI_JSON_FILES) {
      const information = await stat(
        resolveInsideRoot(vaultPath, `.aleksi/${filename}`)
      );
      if (!information.isFile()) {
        return false;
      }
    }

    await readVaultSettingsIfPresent(vaultPath);
    return true;
  } catch (error) {
    if (
      hasErrorCode(error, "ENOENT", "ENOTDIR") ||
      error instanceof VaultServiceError
    ) {
      return false;
    }
    throw error;
  }
}

export async function assertInitializedVault(vaultPath: string): Promise<void> {
  await assertNoExistingSymlinkInPath(vaultPath);
  const initialized = await isInitializedVault(vaultPath);
  if (!initialized) {
    throw new VaultServiceError(
      "VAULT_NOT_INITIALIZED",
      "Vault is not initialized"
    );
  }
}

function readOnlyReasonForError(error: unknown): string {
  if (hasErrorCode(error, "ENOENT")) {
    return "Vault path does not exist";
  }
  if (hasErrorCode(error, "ENOTDIR")) {
    return "Vault path is not a directory";
  }
  if (hasErrorCode(error, "EACCES", "EPERM", "EROFS")) {
    return "Vault path is not writable";
  }
  if (error instanceof VaultServiceError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Vault path is not writable";
}

async function writableStatus(vaultPath: string): Promise<{
  writable: boolean;
  readOnlyReason: string | null;
}> {
  try {
    await assertNoExistingSymlinkInPath(vaultPath);
    const information = await stat(vaultPath);
    if (!information.isDirectory()) {
      return {
        writable: false,
        readOnlyReason: "Vault path is not a directory"
      };
    }
    await access(vaultPath, constants.W_OK);

    const aleksiPath = resolveInsideRoot(vaultPath, ".aleksi");
    try {
      const aleksiInformation = await stat(aleksiPath);
      if (aleksiInformation.isDirectory()) {
        await access(aleksiPath, constants.W_OK);
      }
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }

    return {
      writable: true,
      readOnlyReason: null
    };
  } catch (error) {
    return {
      writable: false,
      readOnlyReason: readOnlyReasonForError(error)
    };
  }
}

export async function getVaultStatus(
  path: string
): Promise<VaultStatus> {
  const vaultPath = resolvePrivilegedAbsolutePath(path);
  const writable = await writableStatus(vaultPath);

  return {
    path: vaultPath,
    initialized: await isInitializedVault(vaultPath),
    writable: writable.writable,
    readOnlyReason: writable.readOnlyReason,
    lastSaveAt: null
  };
}

export async function getActiveVaultStatus(): Promise<VaultStatus | null> {
  const settings = await readAppSettings();
  if (settings === null) {
    return null;
  }

  return getVaultStatus(settings.activeVaultPath);
}

export function defaultLearningLibraryPath(): string {
  return resolve(
    process.env.ALEKSI_DEFAULT_VAULT_PATH ??
      join(homedir(), "Documents", "Aleksi Learning Workbench")
  );
}

export function appDataLearningLibraryPath(): string | null {
  const configured = process.env.ALEKSI_APP_DATA_VAULT_PATH;
  return configured === undefined ? null : resolve(configured);
}

export async function autoPrepareVault(): Promise<VaultStatus> {
  const activeStatus = await getActiveVaultStatus();
  const candidates = Array.from(
    new Set(
      [
        activeStatus?.path ?? null,
        defaultLearningLibraryPath(),
        appDataLearningLibraryPath()
      ].filter((path): path is string => path !== null)
    )
  );
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const status = await getVaultStatus(candidate);
      if (status.initialized && status.writable) {
        if (candidate !== activeStatus?.path) {
          await writeAppSettings(candidate);
        }
        return status;
      }
      if (status.initialized && !status.writable) {
        throw new Error(status.readOnlyReason ?? "学习库不可写");
      }
      return await initializeVault(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("没有可用的本地学习库位置");
}

export async function initializeVault(path: string): Promise<VaultStatus> {
  const vaultPath = resolvePrivilegedAbsolutePath(path);
  await scaffoldVault(vaultPath);
  await writeAppSettings(vaultPath);
  return getVaultStatus(vaultPath);
}

export async function selectVault(path: string): Promise<VaultStatus> {
  const vaultPath = resolvePrivilegedAbsolutePath(path);
  await assertInitializedVault(vaultPath);
  await writeAppSettings(vaultPath);
  return getVaultStatus(vaultPath);
}

async function assertDirectory(path: string): Promise<void> {
  await assertNoExistingSymlinkInPath(path);
  const information = await stat(path);
  if (!information.isDirectory()) {
    throw new VaultServiceError(
      "INVALID_FILESYSTEM_ENTRY",
      "Expected a directory"
    );
  }
}

async function assertEmptyDestination(destinationPath: string): Promise<void> {
  await assertNoExistingSymlinkInPath(destinationPath);

  try {
    const information = await stat(destinationPath);
    if (!information.isDirectory()) {
      throw new VaultServiceError(
        "INVALID_FILESYSTEM_ENTRY",
        "Migration destination must be a directory"
      );
    }
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
    await mkdir(destinationPath, { recursive: true });
  }

  await assertNoExistingSymlinkInPath(destinationPath);
  let hasEntry = false;
  for await (const _entry of await opendir(destinationPath)) {
    hasEntry = true;
    break;
  }
  if (hasEntry) {
    throw new VaultServiceError(
      "DESTINATION_NOT_EMPTY",
      "Migration destination must be empty"
    );
  }
}

async function removeEmptyDestinationDirectory(
  destinationPath: string
): Promise<void> {
  if (!(await pathExists(destinationPath))) {
    return;
  }
  await assertEmptyDestination(destinationPath);
  try {
    await rmdir(destinationPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOTEMPTY", "EEXIST")) {
      throw new VaultServiceError(
        "DESTINATION_NOT_EMPTY",
        "Migration destination changed and is no longer empty",
        409
      );
    }
    throw error;
  }
}

async function copyDirectoryContents(
  sourceRoot: string,
  destinationRoot: string,
  relativePrefix = "",
  budget: IoBudget = createVaultIoBudget(),
  depth = 0
): Promise<void> {
  budget.checkpoint();
  const currentSource = relativePrefix
    ? assertInsideRoot(sourceRoot, join(sourceRoot, relativePrefix))
    : sourceRoot;

  for await (const entry of await opendir(currentSource)) {
    const relativePath = relativePrefix
      ? `${relativePrefix}/${entry.name}`
      : entry.name;
    const sourcePath = assertInsideRoot(sourceRoot, join(sourceRoot, relativePath));
    const destinationPath = assertInsideRoot(
      destinationRoot,
      join(destinationRoot, relativePath)
    );
    const information = await lstat(sourcePath);

    if (information.isSymbolicLink()) {
      throw new VaultServiceError(
        "PATH_AMBIGUOUS",
        "Vault copy rejects symlinks and junctions"
      );
    }
    if (information.isDirectory()) {
      budget.claimFile(0, depth + 1);
      await mkdir(destinationPath);
      await copyDirectoryContents(
        sourceRoot,
        destinationRoot,
        relativePath,
        budget,
        depth + 1
      );
      continue;
    }
    if (information.isFile()) {
      budget.claimFile(information.size, depth);
      await copyFile(
        sourcePath,
        destinationPath,
        constants.COPYFILE_EXCL
      );
      continue;
    }

    throw new VaultServiceError(
      "INVALID_FILESYSTEM_ENTRY",
      "Vault copy supports only files and directories"
    );
  }
}

async function streamFileSha256(
  entryPath: string,
  budget: IoBudget
): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(entryPath)) {
    budget.checkpoint();
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function collectFileDigests(
  root: string,
  relativePrefix = "",
  budget: IoBudget = createVaultIoBudget(),
  depth = 0
): Promise<FileDigest[]> {
  budget.checkpoint();
  const current = relativePrefix
    ? assertInsideRoot(root, join(root, relativePrefix))
    : root;
  const digests: FileDigest[] = [];

  for await (const entry of await opendir(current)) {
    const relativePath = relativePrefix
      ? `${relativePrefix}/${entry.name}`
      : entry.name;
    const entryPath = assertInsideRoot(root, join(root, relativePath));
    const information = await lstat(entryPath);

    if (information.isSymbolicLink()) {
      throw new VaultServiceError(
        "PATH_AMBIGUOUS",
        "Vault verification rejects symlinks and junctions"
      );
    }
    if (information.isDirectory()) {
      budget.claimFile(0, depth + 1);
      digests.push(
        ...(await collectFileDigests(
          root,
          relativePath,
          budget,
          depth + 1
        ))
      );
      continue;
    }
    if (information.isFile()) {
      budget.claimFile(information.size, depth);
      digests.push({
        relativePath,
        sha256: await streamFileSha256(entryPath, budget),
        size: information.size
      });
      continue;
    }

    throw new VaultServiceError(
      "INVALID_FILESYSTEM_ENTRY",
      "Vault verification supports only files and directories"
    );
  }

  return digests.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

async function transferVaultSnapshot(
  sourcePath: string,
  finalPath: string,
  operation: "backup" | "migration",
  faults?: FaultController
): Promise<void> {
  const transactionId = randomUUID();
  const partialPath = `${finalPath}.partial-${transactionId}`;
  const manifestPath = `${partialPath}.manifest.json`;
  const sourceSettings = await readVaultSettingsIfPresent(sourcePath);
  let preserveInterruptedArtifacts = false;
  const runFaultBoundary = async (
    name: string,
    preserveOnThrow: boolean
  ): Promise<void> => {
    try {
      await faults?.boundary(name);
    } catch (error) {
      preserveInterruptedArtifacts ||= preserveOnThrow;
      throw error;
    }
  };
  const manifest: VaultTransferManifest = vaultTransferManifestSchema.parse({
    schemaVersion: 1,
    transactionId,
    operation,
    sourceVaultId: sourceSettings?.vaultId ?? null,
    sourcePath,
    finalPath,
    startedAt: new Date().toISOString(),
    completed: false,
    phase: "copying",
    files: await collectFileDigests(sourcePath),
    finalFiles: null
  });
  await mkdir(partialPath);
  try {
    await atomicWriteText(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { root: dirname(manifestPath) }
    );
    await runFaultBoundary("vault-transfer:copying", true);
    await copyDirectoryContents(sourcePath, partialPath);
    await runFaultBoundary("vault-transfer:copied", false);
    const copied = await collectFileDigests(partialPath);
    if (JSON.stringify(copied) !== JSON.stringify(manifest.files)) {
      throw new VaultServiceError(
        "HASH_VERIFICATION_FAILED",
        "Copied Vault files did not match the transfer manifest"
      );
    }
    const sourceAfterCopy = await collectFileDigests(sourcePath);
    if (JSON.stringify(sourceAfterCopy) !== JSON.stringify(manifest.files)) {
      throw new VaultServiceError(
        "HASH_VERIFICATION_FAILED",
        "Source Vault changed during transfer"
      );
    }
    if (operation === "migration") {
      await scaffoldVault(partialPath);
    }
    const completedManifest: VaultTransferManifest = vaultTransferManifestSchema.parse({
      ...manifest,
      completed: true,
      phase: "ready",
      finalFiles:
        operation === "migration"
          ? await collectFileDigests(partialPath)
          : null
    });
    if (operation === "backup") {
      await atomicWriteText(
        resolveInsideRoot(partialPath, ".aleksi/backup-manifest.json"),
        `${JSON.stringify(completedManifest, null, 2)}\n`,
        { root: partialPath }
      );
      await runFaultBoundary("vault-transfer:backup-manifest-written", true);
      await atomicWriteText(
        manifestPath,
        `${JSON.stringify(completedManifest, null, 2)}\n`,
        { root: dirname(manifestPath) }
      );
    } else {
      await atomicWriteText(
        resolveInsideRoot(partialPath, MIGRATION_MANIFEST_PATH),
        `${JSON.stringify(completedManifest, null, 2)}\n`,
        { root: partialPath }
      );
      await runFaultBoundary(
        "vault-transfer:migration-manifest-written",
        true
      );
      await atomicWriteText(
        manifestPath,
        `${JSON.stringify(completedManifest, null, 2)}\n`,
        { root: dirname(manifestPath) }
      );
    }
    await runFaultBoundary("vault-transfer:ready", true);
    await removeEmptyDestinationDirectory(finalPath);
    await rename(partialPath, finalPath);
    await runFaultBoundary("vault-transfer:renamed", true);
    await rm(manifestPath, { force: true });
  } catch (error) {
    if (preserveInterruptedArtifacts) {
      throw error;
    }
    await rm(partialPath, { force: true, recursive: true }).catch(
      () => undefined
    );
    await rm(manifestPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function discoverInterruptedMigration(
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  const parent = dirname(destinationPath);
  const prefix = `${basename(destinationPath)}.partial-`;
  const suffix = ".manifest.json";
  const names: string[] = [];
  const budget = createVaultIoBudget();
  try {
    for await (const entry of await opendir(parent)) {
      budget.claimFile(0, 0);
      if (
        !entry.name.startsWith(prefix) ||
        !entry.name.endsWith(suffix)
      ) {
        continue;
      }
      names.push(entry.name);
      names.sort((left, right) => left.localeCompare(right));
      if (names.length > 256) {
        names.shift();
      }
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) {
      return;
    }
    throw error;
  }
  const sourceSettings = await readVaultSettingsIfPresent(sourcePath);
  for (const name of names) {
    budget.checkpoint();
    const manifestPath = assertInsideRoot(parent, join(parent, name));
    const partialPath = manifestPath.slice(0, -suffix.length);
    let manifest: VaultTransferManifest;
    try {
      manifest = parseVaultTransferManifest(
        (
          await readBoundedRegularFile(parent, manifestPath, {
            maxBytes: MAX_TRANSFER_MANIFEST_BYTES,
            label: "Interrupted migration manifest"
          })
        ).data.toString("utf8")
      );
    } catch {
      throw new VaultServiceError(
        "HASH_VERIFICATION_FAILED",
        `Interrupted migration manifest is unreadable: ${name}`
      );
    }
    if (
      manifest.schemaVersion !== 1 ||
      manifest.operation !== "migration" ||
      manifest.sourceVaultId !== (sourceSettings?.vaultId ?? null) ||
      manifest.sourcePath !== sourcePath ||
      manifest.finalPath !== destinationPath
    ) {
      continue;
    }
    if (!manifest.completed || manifest.phase !== "ready") {
      try {
        const embedded = parseVaultTransferManifest(
          (
            await readBoundedRegularFile(
              partialPath,
              resolveInsideRoot(partialPath, MIGRATION_MANIFEST_PATH),
              {
                maxBytes: MAX_TRANSFER_MANIFEST_BYTES,
                label: "Embedded interrupted migration manifest"
              }
            )
          ).data.toString("utf8")
        );
        if (
          embedded.operation !== "migration" ||
          embedded.completed !== true ||
          embedded.phase !== "ready" ||
          embedded.transactionId !== manifest.transactionId ||
          embedded.sourceVaultId !== manifest.sourceVaultId ||
          embedded.sourcePath !== sourcePath ||
          embedded.finalPath !== destinationPath
        ) {
          throw new VaultServiceError(
            "HASH_VERIFICATION_FAILED",
            "Embedded interrupted migration manifest does not match its transaction"
          );
        }
        manifest = embedded;
      } catch (error) {
        if (error instanceof VaultServiceError) {
          throw error;
        }
        if (!hasErrorCode(error, "ENOENT", "ENOTDIR")) {
          throw new VaultServiceError(
            "HASH_VERIFICATION_FAILED",
            "Embedded interrupted migration manifest is unreadable"
          );
        }
        await rm(partialPath, { force: true, recursive: true });
        await rm(manifestPath, { force: true });
        continue;
      }
    }
    const expected = manifest.finalFiles ?? manifest.files;
    if (
      !(await pathExists(partialPath)) &&
      (await pathExists(destinationPath))
    ) {
      const finalized = (
        await collectFileDigests(destinationPath, "", budget)
      ).filter(
        (entry) => entry.relativePath !== MIGRATION_MANIFEST_PATH
      );
      if (JSON.stringify(finalized) !== JSON.stringify(expected)) {
        throw new VaultServiceError(
          "HASH_VERIFICATION_FAILED",
          "Interrupted migration destination no longer matches its verified manifest"
        );
      }
      await rm(manifestPath, { force: true });
      return;
    }
    const actual = (await collectFileDigests(partialPath, "", budget)).filter(
      (entry) => entry.relativePath !== MIGRATION_MANIFEST_PATH
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new VaultServiceError(
        "HASH_VERIFICATION_FAILED",
        "Interrupted migration partial no longer matches its verified manifest"
      );
    }
    await removeEmptyDestinationDirectory(destinationPath);
    await rename(partialPath, destinationPath);
    await rm(manifestPath, { force: true });
    return;
  }
}

async function resumeCompletedMigration(
  sourcePath: string,
  destinationPath: string
): Promise<boolean> {
  if (!(await pathExists(destinationPath))) {
    return false;
  }
  let manifest: VaultTransferManifest;
  try {
    manifest = parseVaultTransferManifest(
      (
        await readBoundedRegularFile(
          destinationPath,
          resolveInsideRoot(destinationPath, MIGRATION_MANIFEST_PATH),
          {
            maxBytes: MAX_TRANSFER_MANIFEST_BYTES,
            label: "Interrupted migration manifest"
          }
        )
      ).data.toString("utf8")
    );
  } catch (error) {
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) {
      return false;
    }
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Interrupted migration manifest is unreadable"
    );
  }
  const sourceSettings = await readVaultSettingsIfPresent(sourcePath);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.operation !== "migration" ||
    manifest.completed !== true ||
    manifest.sourceVaultId !== (sourceSettings?.vaultId ?? null) ||
    !Array.isArray(manifest.files)
  ) {
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Interrupted migration manifest does not match the requested source"
    );
  }
  const copied = (await collectFileDigests(destinationPath)).filter(
    (entry) => entry.relativePath !== MIGRATION_MANIFEST_PATH
  );
  const expected = manifest.finalFiles ?? manifest.files;
  if (JSON.stringify(copied) !== JSON.stringify(expected)) {
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Interrupted migration destination no longer matches its verified manifest"
    );
  }
  return true;
}

export async function migrateVault(
  sourcePathInput: string,
  destinationPathInput: string,
  options: { faults?: FaultController } = {}
): Promise<VaultStatus> {
  const sourcePath = resolvePrivilegedAbsolutePath(sourcePathInput);
  const destinationPath = resolvePrivilegedAbsolutePath(destinationPathInput);

  await assertDirectory(sourcePath);
  await assertNoExistingSymlinkInPath(destinationPath);
  await assertVaultPathsDoNotOverlap(sourcePath, destinationPath);
  await readVaultSettingsIfPresent(sourcePath);
  await discoverInterruptedMigration(sourcePath, destinationPath);
  if (await resumeCompletedMigration(sourcePath, destinationPath)) {
    await scaffoldVault(destinationPath);
    await writeAppSettings(destinationPath);
    await rm(resolveInsideRoot(destinationPath, MIGRATION_MANIFEST_PATH), {
      force: true
    });
    return getVaultStatus(destinationPath);
  }
  await assertEmptyDestination(destinationPath);

  await transferVaultSnapshot(
    sourcePath,
    destinationPath,
    "migration",
    options.faults
  );
  await scaffoldVault(destinationPath);

  await writeAppSettings(destinationPath);
  await rm(resolveInsideRoot(destinationPath, MIGRATION_MANIFEST_PATH), {
    force: true
  });

  return getVaultStatus(destinationPath);
}

function padNumber(value: number, length: number): string {
  return value.toString().padStart(length, "0");
}

export function formatFilesystemUtcStamp(date: Date): string {
  const timestamp = [
    padNumber(date.getUTCFullYear(), 4),
    padNumber(date.getUTCMonth() + 1, 2),
    padNumber(date.getUTCDate(), 2),
    "T",
    padNumber(date.getUTCHours(), 2),
    padNumber(date.getUTCMinutes(), 2),
    padNumber(date.getUTCSeconds(), 2),
    padNumber(date.getUTCMilliseconds(), 3),
    "Z"
  ].join("");

  if (!/^\d{8}T\d{9}Z$/u.test(timestamp)) {
    throw new Error("Generated filesystem timestamp has an invalid shape");
  }

  return timestamp;
}

async function reserveBackupDirectory(parentPath: string): Promise<string> {
  const basePath = join(
    parentPath,
    `Aleksi-Learning-Vault-backup-${formatFilesystemUtcStamp(new Date())}`
  );

  for (let index = 1; ; index += 1) {
    const candidate = index === 1 ? basePath : `${basePath}-${index}`;
    if (!(await pathExists(candidate))) return candidate;
  }
}

export async function backupActiveVault(
  options: { faults?: FaultController } = {}
): Promise<{
  backupPath: string;
  status: VaultStatus;
}> {
  const settings = await readAppSettings();
  if (settings === null) {
    throw new VaultServiceError(
      "ACTIVE_VAULT_NOT_CONFIGURED",
      "No active Vault is configured"
    );
  }

  const vaultPath = resolvePrivilegedAbsolutePath(settings.activeVaultPath);
  await assertInitializedVault(vaultPath);
  const backupPath = await reserveBackupDirectory(dirname(vaultPath));

  await transferVaultSnapshot(vaultPath, backupPath, "backup", options.faults);

  return {
    backupPath,
    status: await getVaultStatus(vaultPath)
  };
}
