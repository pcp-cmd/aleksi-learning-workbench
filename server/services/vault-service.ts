import { constants, createReadStream } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
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

const VAULT_IO_LIMITS = {
  maxDepth: 64,
  maxFiles: 100_000,
  maxFileBytes: 4 * 1024 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024 * 1024,
  maxConcurrency: 8
} as const;

function createVaultIoBudget(): IoBudget {
  return new IoBudget({
    ...VAULT_IO_LIMITS,
    deadlineAt: Date.now() + 30 * 60 * 1000
  });
}

type VaultServiceErrorCode =
  | "ACTIVE_VAULT_NOT_CONFIGURED"
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

type FileDigest = {
  relativePath: string;
  sha256: string;
  size: number;
};

type VaultTransferManifest = {
  schemaVersion: 1;
  transactionId: string;
  operation: "backup" | "migration";
  sourceVaultId: string | null;
  sourcePath?: string;
  finalPath?: string;
  startedAt: string;
  completed: boolean;
  phase?: "copying" | "ready";
  files: FileDigest[];
  finalFiles?: FileDigest[] | null;
};

const MIGRATION_MANIFEST_PATH = ".aleksi/migration-manifest.json";
const MAX_TRANSFER_MANIFEST_BYTES = 64 * 1024 * 1024;

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

async function assertMigrationPathsDoNotOverlap(
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
      "Migration source and destination must not overlap"
    );
  }
}

async function assertNoExistingSymlinkInPath(path: string): Promise<void> {
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
    return parseVaultSettings(await readFile(settingsPath, "utf8"));
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
  const entries = await readdir(destinationPath);
  if (entries.length > 0) {
    throw new VaultServiceError(
      "DESTINATION_NOT_EMPTY",
      "Migration destination must be empty"
    );
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

  const entries = await readdir(currentSource, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
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
      if (depth + 1 > budget.limits.maxDepth) {
        budget.claimFile(0, depth + 1);
      }
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
  const entries = await readdir(current, { withFileTypes: true });
  const digests: FileDigest[] = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
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
      if (depth + 1 > budget.limits.maxDepth) {
        budget.claimFile(0, depth + 1);
      }
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

  return digests;
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
  const manifest: VaultTransferManifest = {
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
  };
  await mkdir(partialPath);
  try {
    await atomicWriteText(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { root: dirname(manifestPath) }
    );
    await copyDirectoryContents(sourcePath, partialPath);
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
    const completedManifest: VaultTransferManifest = {
      ...manifest,
      completed: true,
      phase: "ready",
      finalFiles:
        operation === "migration"
          ? await collectFileDigests(partialPath)
          : null
    };
    await atomicWriteText(
      manifestPath,
      `${JSON.stringify(completedManifest, null, 2)}\n`,
      { root: dirname(manifestPath) }
    );
    if (operation === "backup") {
      await atomicWriteText(
        resolveInsideRoot(partialPath, ".aleksi/backup-manifest.json"),
        `${JSON.stringify(completedManifest, null, 2)}\n`,
        { root: partialPath }
      );
    } else {
      await atomicWriteText(
        resolveInsideRoot(partialPath, MIGRATION_MANIFEST_PATH),
        `${JSON.stringify(completedManifest, null, 2)}\n`,
        { root: partialPath }
      );
    }
    await faults?.boundary("vault-transfer:ready");
    if (await pathExists(finalPath)) {
      await assertEmptyDestination(finalPath);
      await rm(finalPath, { recursive: true });
    }
    await rename(partialPath, finalPath);
    await faults?.boundary("vault-transfer:renamed");
    await rm(manifestPath, { force: true });
  } catch (error) {
    if (
      faults !== undefined &&
      faults
        .snapshot()
        .some((boundary) =>
          ["vault-transfer:ready", "vault-transfer:renamed"].includes(boundary)
        )
    ) {
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
  let names: string[];
  try {
    names = await readdir(parent);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) {
      return;
    }
    throw error;
  }
  const sourceSettings = await readVaultSettingsIfPresent(sourcePath);
  for (const name of names
    .filter((candidate) => candidate.startsWith(prefix) && candidate.endsWith(suffix))
    .sort()) {
    const manifestPath = assertInsideRoot(parent, join(parent, name));
    const partialPath = manifestPath.slice(0, -suffix.length);
    let manifest: VaultTransferManifest;
    try {
      manifest = JSON.parse(
        (
          await readBoundedRegularFile(parent, manifestPath, {
            maxBytes: MAX_TRANSFER_MANIFEST_BYTES,
            label: "Interrupted migration manifest"
          })
        ).data.toString("utf8")
      ) as VaultTransferManifest;
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
      await rm(partialPath, { force: true, recursive: true });
      await rm(manifestPath, { force: true });
      continue;
    }
    const expected = manifest.finalFiles ?? manifest.files;
    if (
      !(await pathExists(partialPath)) &&
      (await pathExists(destinationPath))
    ) {
      const finalized = (await collectFileDigests(destinationPath)).filter(
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
    const actual = (await collectFileDigests(partialPath)).filter(
      (entry) => entry.relativePath !== MIGRATION_MANIFEST_PATH
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new VaultServiceError(
        "HASH_VERIFICATION_FAILED",
        "Interrupted migration partial no longer matches its verified manifest"
      );
    }
    if (await pathExists(destinationPath)) {
      await assertEmptyDestination(destinationPath);
      await rm(destinationPath, { recursive: true });
    }
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
    manifest = JSON.parse(
      await readFile(
        resolveInsideRoot(destinationPath, MIGRATION_MANIFEST_PATH),
        "utf8"
      )
    ) as VaultTransferManifest;
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
  await assertMigrationPathsDoNotOverlap(sourcePath, destinationPath);
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

export async function backupActiveVault(): Promise<{
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

  await transferVaultSnapshot(vaultPath, backupPath, "backup");

  return {
    backupPath,
    status: await getVaultStatus(vaultPath)
  };
}
