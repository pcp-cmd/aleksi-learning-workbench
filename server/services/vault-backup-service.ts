import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  opendir,
  rename,
  rmdir,
  rm
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { DEFAULT_VAULT_DIRECTORIES } from "../../shared/vault-map";
import { atomicWriteText } from "../lib/atomic-write";
import { readBoundedRegularFile } from "../lib/bounded-regular-file";
import { hasErrorCode } from "../lib/error-code";
import { IoBudget, IoBudgetError } from "../lib/io-budget";
import {
  assertInsideRoot,
  assertRealPathInsideRoot,
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "../lib/path-safety";
import type { FaultController } from "../testing/fault-controller";
import {
  parseVaultTransferManifest,
  vaultTransferFileDigestSchema,
  type FileDigest,
  type VaultTransferManifest
} from "./vault-transfer-schema";
import {
  assertNoExistingSymlinkInPath,
  assertVaultPathsDoNotOverlap,
  createVaultIoBudget,
  resolvePrivilegedAbsolutePath,
  VAULT_IO_LIMITS,
  VaultServiceError
} from "./vault-service";

const MAX_BACKUP_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_CANDIDATES = 256;
const BACKUP_PREFIX = "Aleksi-Learning-Vault-backup-";
const BACKUP_MANIFEST = ".aleksi/backup-manifest.json";
const BACKUP_CLEANUP_HEALTH = ".aleksi/health/backup-cleanup.json";

const restoreManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    transactionId: z.string().uuid(),
    backupPath: z.string().min(1),
    destinationPath: z.string().min(1),
    completed: z.boolean(),
    files: z.array(vaultTransferFileDigestSchema).max(VAULT_IO_LIMITS.maxFiles)
  })
  .strict();

type RestoreManifest = z.infer<typeof restoreManifestSchema>;

export type BackupDiscoveryRecord = Readonly<{
  path: string;
  status:
    | "verified"
    | "incomplete"
    | "verified-needs-finalize"
    | "invalid"
    | "orphaned";
  transactionId: string | null;
  fileCount: number | null;
  totalBytes: number | null;
  diagnostics: readonly string[];
}>;

const backupCleanupHealthSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["healthy", "failed"]),
    attempts: z.number().int().nonnegative(),
    lastFailureAt: z.string().datetime({ offset: true }).nullable(),
    lastSuccessfulCleanupAt: z.string().datetime({ offset: true }).nullable(),
    category: z.literal("BACKUP_RETENTION_CLEANUP_FAILED").nullable(),
    candidateName: z.string().min(1).nullable(),
    updatedAt: z.string().datetime({ offset: true })
  })
  .strict();

export type BackupCleanupHealth = z.infer<typeof backupCleanupHealthSchema>;

export type BackupCandidateExport = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  candidate: BackupDiscoveryRecord;
  files: readonly FileDigest[];
  exportToken: string;
}>;

const cleanupHealthMemory = new Map<string, BackupCleanupHealth>();

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function cleanupHealthKey(vaultPath: string): string {
  return resolve(vaultPath);
}

function sameAbsolutePath(first: string, second: string): boolean {
  return relative(resolve(first), resolve(second)) === "";
}

async function persistCleanupHealth(
  vaultPath: string,
  health: BackupCleanupHealth
): Promise<void> {
  cleanupHealthMemory.set(cleanupHealthKey(vaultPath), health);
  await atomicWriteText(
    resolveInsideRoot(vaultPath, BACKUP_CLEANUP_HEALTH),
    `${JSON.stringify(backupCleanupHealthSchema.parse(health), null, 2)}\n`,
    { root: vaultPath }
  );
}

export async function readBackupCleanupHealth(
  vaultPathInput: string
): Promise<BackupCleanupHealth | null> {
  const vaultPath = resolvePrivilegedAbsolutePath(vaultPathInput);
  try {
    const raw = (
      await readBoundedRegularFile(
        vaultPath,
        resolveInsideRoot(vaultPath, BACKUP_CLEANUP_HEALTH),
        {
          maxBytes: MAX_BACKUP_MANIFEST_BYTES,
          label: "Backup cleanup health"
        }
      )
    ).data.toString("utf8");
    const parsed = backupCleanupHealthSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Cleanup health also has an in-memory fallback when its durable copy fails.
  }
  return cleanupHealthMemory.get(cleanupHealthKey(vaultPath)) ?? null;
}

async function recordCleanupFailure(
  vaultPath: string,
  candidatePath: string
): Promise<BackupCleanupHealth> {
  const previous = await readBackupCleanupHealth(vaultPath);
  const now = new Date().toISOString();
  const health = backupCleanupHealthSchema.parse({
    schemaVersion: 1,
    status: "failed",
    attempts: (previous?.attempts ?? 0) + 1,
    lastFailureAt: now,
    lastSuccessfulCleanupAt: previous?.lastSuccessfulCleanupAt ?? null,
    category: "BACKUP_RETENTION_CLEANUP_FAILED",
    candidateName: basename(candidatePath),
    updatedAt: now
  });
  await persistCleanupHealth(vaultPath, health).catch(() => undefined);
  return health;
}

async function recordCleanupSuccess(
  vaultPath: string
): Promise<BackupCleanupHealth> {
  const now = new Date().toISOString();
  const health = backupCleanupHealthSchema.parse({
    schemaVersion: 1,
    status: "healthy",
    attempts: 0,
    lastFailureAt: null,
    lastSuccessfulCleanupAt: now,
    category: null,
    candidateName: null,
    updatedAt: now
  });
  await persistCleanupHealth(vaultPath, health).catch(() => undefined);
  return health;
}

async function sha256File(path: string, budget: IoBudget): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    budget.checkpoint();
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function collectDigests(
  root: string,
  options: {
    budget?: IoBudget;
    excludeBackupManifest?: boolean;
  } = {}
): Promise<FileDigest[]> {
  const budget = options.budget ?? createVaultIoBudget();
  const digests: FileDigest[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    budget.checkpoint();
    if (depth > budget.limits.maxDepth) {
      budget.claimFile(0, depth);
    }
    await assertRealPathInsideRoot(root, directory);
    for await (const entry of await opendir(directory)) {
      const absolutePath = assertInsideRoot(root, join(directory, entry.name));
      const relativePath = normalizeVaultRelativePath(
        relative(root, absolutePath).split("\\").join("/")
      );
      if (
        options.excludeBackupManifest === true &&
        relativePath === BACKUP_MANIFEST
      ) {
        continue;
      }
      const information = await lstat(absolutePath);
      if (information.isSymbolicLink()) {
        throw new VaultServiceError(
          "HASH_VERIFICATION_FAILED",
          "Backup verification rejects symbolic links and junctions"
        );
      }
      if (information.isDirectory()) {
        budget.claimFile(0, depth + 1);
        await visit(absolutePath, depth + 1);
        continue;
      }
      if (!information.isFile()) {
        throw new VaultServiceError(
          "HASH_VERIFICATION_FAILED",
          "Backup contains an unsupported filesystem entry"
        );
      }
      budget.claimFile(information.size, depth);
      digests.push({
        relativePath,
        sha256: await sha256File(absolutePath, budget),
        size: information.size
      });
    }
  };
  await visit(root, 0);
  return digests.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

function sameDigests(
  left: readonly FileDigest[],
  right: readonly FileDigest[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readBackupManifest(
  backupPath: string
): Promise<VaultTransferManifest> {
  const raw = (
    await readBoundedRegularFile(
      backupPath,
      resolveInsideRoot(backupPath, BACKUP_MANIFEST),
      {
        maxBytes: MAX_BACKUP_MANIFEST_BYTES,
        label: "Backup manifest"
      }
    )
  ).data.toString("utf8");
  const manifest = parseVaultTransferManifest(raw);
  if (
    manifest.operation !== "backup" ||
    !manifest.completed ||
    manifest.phase !== "ready" ||
    manifest.finalFiles !== null
  ) {
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Backup manifest does not describe a completed backup"
    );
  }
  return manifest;
}

export async function verifyBackup(
  backupPathInput: string,
  options: { budget?: IoBudget } = {}
): Promise<{ manifest: VaultTransferManifest; files: FileDigest[] }> {
  const backupPath = resolvePrivilegedAbsolutePath(backupPathInput);
  const manifest = await readBackupManifest(backupPath);
  const files = await collectDigests(backupPath, {
    budget: options.budget,
    excludeBackupManifest: true
  });
  if (!sameDigests(files, manifest.files)) {
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Backup contents do not match the verified manifest"
    );
  }
  return { manifest, files };
}

async function copyVerifiedFiles(
  sourceRoot: string,
  destinationRoot: string,
  files: readonly FileDigest[],
  budget: IoBudget = createVaultIoBudget()
): Promise<void> {
  for (const file of files) {
    budget.claimFile(file.size, file.relativePath.split("/").length - 1);
    const source = resolveInsideRoot(sourceRoot, file.relativePath);
    const destination = resolveInsideRoot(destinationRoot, file.relativePath);
    await assertRealPathInsideRoot(sourceRoot, source);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

async function ensureVaultDirectories(root: string): Promise<void> {
  await Promise.all(
    DEFAULT_VAULT_DIRECTORIES.map((relativePath) =>
      mkdir(resolveInsideRoot(root, relativePath), { recursive: true })
    )
  );
}

async function assertNewEmptyDestination(path: string): Promise<void> {
  if (!(await exists(path))) {
    return;
  }
  const information = await lstat(path);
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new VaultServiceError(
      "DESTINATION_NOT_EMPTY",
      "Restore destination must be a new empty directory",
      409
    );
  }
  let hasEntry = false;
  for await (const _entry of await opendir(path)) {
    hasEntry = true;
    break;
  }
  if (hasEntry) {
    throw new VaultServiceError(
      "DESTINATION_NOT_EMPTY",
      "Restore destination must be a new empty directory",
      409
    );
  }
}

async function removeEmptyDestinationIfPresent(path: string): Promise<void> {
  if (!(await exists(path))) {
    return;
  }
  try {
    await rmdir(path);
  } catch (error) {
    if (hasErrorCode(error, "ENOTEMPTY", "EEXIST")) {
      throw new VaultServiceError(
        "DESTINATION_NOT_EMPTY",
        "Restore destination changed and is no longer empty",
        409
      );
    }
    throw error;
  }
}

async function discoverRestoreResume(
  backupPath: string,
  destinationPath: string
): Promise<{ partialPath: string; manifestPath: string; manifest: RestoreManifest } | null> {
  const parent = dirname(destinationPath);
  const prefix = `${basename(destinationPath)}.restore-partial-`;
  const names: string[] = [];
  const budget = createVaultIoBudget();
  try {
    for await (const entry of await opendir(parent)) {
      budget.claimFile(0, 0);
      if (
        !entry.name.startsWith(prefix) ||
        !entry.name.endsWith(".manifest.json")
      ) {
        continue;
      }
      names.push(entry.name);
      names.sort((left, right) => left.localeCompare(right));
      if (names.length > MAX_BACKUP_CANDIDATES) {
        names.shift();
      }
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
  for (const name of names) {
    budget.checkpoint();
    const manifestPath = assertInsideRoot(parent, join(parent, name));
    try {
      const manifest = restoreManifestSchema.parse(
        JSON.parse(
          (
            await readBoundedRegularFile(parent, manifestPath, {
              maxBytes: MAX_BACKUP_MANIFEST_BYTES,
              label: "Restore manifest"
            })
          ).data.toString("utf8")
        )
      );
      if (
        resolve(manifest.backupPath) === backupPath &&
        resolve(manifest.destinationPath) === destinationPath
      ) {
        return {
          partialPath: manifestPath.slice(0, -".manifest.json".length),
          manifestPath,
          manifest
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function restoreBackupToNewLocation(
  backupPathInput: string,
  destinationPathInput: string,
  options: { activeVaultPath?: string; faults?: FaultController } = {}
): Promise<{ destinationPath: string; fileCount: number; totalBytes: number }> {
  const backupPath = resolvePrivilegedAbsolutePath(backupPathInput);
  const destinationPath = resolvePrivilegedAbsolutePath(destinationPathInput);
  await assertNoExistingSymlinkInPath(destinationPath);
  await assertVaultPathsDoNotOverlap(backupPath, destinationPath);
  if (options.activeVaultPath !== undefined) {
    await assertVaultPathsDoNotOverlap(
      resolvePrivilegedAbsolutePath(options.activeVaultPath),
      destinationPath
    );
  }
  const verified = await verifyBackup(backupPath);
  const resumed = await discoverRestoreResume(backupPath, destinationPath);
  if (resumed !== null) {
    const actualRoot = (await exists(resumed.partialPath))
      ? resumed.partialPath
      : destinationPath;
    const actual = await collectDigests(actualRoot);
    if (!resumed.manifest.completed || !sameDigests(actual, verified.files)) {
      throw new VaultServiceError(
        "HASH_VERIFICATION_FAILED",
        "Interrupted restore does not match its verified manifest"
      );
    }
    if (actualRoot === resumed.partialPath) {
      await ensureVaultDirectories(resumed.partialPath);
      await assertNewEmptyDestination(destinationPath);
      await removeEmptyDestinationIfPresent(destinationPath);
      await rename(resumed.partialPath, destinationPath);
    }
    await rm(resumed.manifestPath, { force: true });
    return {
      destinationPath,
      fileCount: verified.files.length,
      totalBytes: verified.files.reduce((sum, file) => sum + file.size, 0)
    };
  }

  await assertNewEmptyDestination(destinationPath);
  const transactionId = randomUUID();
  const partialPath = `${destinationPath}.restore-partial-${transactionId}`;
  const manifestPath = `${partialPath}.manifest.json`;
  const manifest: RestoreManifest = {
    schemaVersion: 1,
    transactionId,
    backupPath,
    destinationPath,
    completed: false,
    files: verified.files
  };
  await mkdir(partialPath);
  try {
    await atomicWriteText(
      manifestPath,
      `${JSON.stringify(restoreManifestSchema.parse(manifest), null, 2)}\n`,
      { root: dirname(manifestPath) }
    );
    await copyVerifiedFiles(backupPath, partialPath, verified.files);
    await ensureVaultDirectories(partialPath);
    const actual = await collectDigests(partialPath);
    if (!sameDigests(actual, verified.files)) {
      throw new VaultServiceError(
        "HASH_VERIFICATION_FAILED",
        "Restored files do not match the backup manifest"
      );
    }
    await atomicWriteText(
      manifestPath,
      `${JSON.stringify(
        restoreManifestSchema.parse({ ...manifest, completed: true }),
        null,
        2
      )}\n`,
      { root: dirname(manifestPath) }
    );
    await options.faults?.boundary("backup-restore:verified");
    await removeEmptyDestinationIfPresent(destinationPath);
    await rename(partialPath, destinationPath);
    await options.faults?.boundary("backup-restore:renamed");
    await rm(manifestPath, { force: true });
  } catch (error) {
    const preserve = options.faults
      ?.snapshot()
      .some((boundary) =>
        ["backup-restore:verified", "backup-restore:renamed"].includes(boundary)
      );
    if (!preserve) {
      await rm(partialPath, { force: true, recursive: true }).catch(() => undefined);
      await rm(manifestPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
  return {
    destinationPath,
    fileCount: verified.files.length,
    totalBytes: verified.files.reduce((sum, file) => sum + file.size, 0)
  };
}

export async function discoverBackups(
  activeVaultPath: string
): Promise<BackupDiscoveryRecord[]> {
  const parent = dirname(activeVaultPath);
  const budget = createVaultIoBudget();
  const candidateNames: string[] = [];
  try {
    for await (const entry of await opendir(parent)) {
      budget.claimFile(0, 0);
      if (!entry.name.startsWith(BACKUP_PREFIX)) {
        continue;
      }
      candidateNames.push(entry.name);
      candidateNames.sort((left, right) => left.localeCompare(right));
      if (candidateNames.length > MAX_BACKUP_CANDIDATES) {
        candidateNames.shift();
      }
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) {
      return [];
    }
    throw error;
  }
  const records: BackupDiscoveryRecord[] = [];
  const manifests = new Set(
    candidateNames.filter((name) => name.endsWith(".manifest.json"))
  );
  for (const name of candidateNames) {
    budget.checkpoint();
    const path = assertInsideRoot(parent, join(parent, name));
    if (sameAbsolutePath(path, activeVaultPath)) {
      continue;
    }
    if (name.endsWith(".manifest.json")) {
      try {
        const manifest = parseVaultTransferManifest(
          (
            await readBoundedRegularFile(parent, path, {
              maxBytes: MAX_BACKUP_MANIFEST_BYTES,
              label: "Interrupted backup manifest"
            })
          ).data.toString("utf8")
        );
        const partialPath = path.slice(0, -".manifest.json".length);
        const partialExists = await exists(partialPath);
        let status: BackupDiscoveryRecord["status"];
        const diagnostics: string[] = [];
        if (!partialExists) {
          status = "orphaned";
          records.push({
            path,
            status,
            transactionId: manifest.transactionId,
            fileCount: manifest.files.length,
            totalBytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
            diagnostics: ["Interrupted backup manifest has no partial payload"]
          });
          continue;
        } else if (manifest.completed && manifest.phase === "ready") {
          try {
            const verified = await verifyBackup(partialPath, { budget });
            status =
              JSON.stringify(verified.manifest) === JSON.stringify(manifest)
                ? "verified-needs-finalize"
                : "invalid";
            if (status === "invalid") {
              diagnostics.push(
                "Interrupted backup manifests do not describe the same verified snapshot"
              );
            }
          } catch (error) {
            if (error instanceof IoBudgetError) {
              throw error;
            }
            status = "invalid";
            diagnostics.push(
              "Interrupted backup payload does not match its verified manifest"
            );
          }
        } else {
          status = "incomplete";
        }
        records.push({
          path: partialPath,
          status,
          transactionId: manifest.transactionId,
          fileCount: manifest.files.length,
          totalBytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
          diagnostics
        });
      } catch (error) {
        if (error instanceof IoBudgetError) {
          throw error;
        }
        records.push({
          path,
          status: "invalid",
          transactionId: null,
          fileCount: null,
          totalBytes: null,
          diagnostics: ["Interrupted backup manifest is invalid"]
        });
      }
      continue;
    }
    let information;
    try {
      information = await lstat(path);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        continue;
      }
      throw error;
    }
    if (!information.isDirectory()) continue;
    if (name.includes(".partial-")) {
      if (!manifests.has(`${name}.manifest.json`)) {
        records.push({
          path,
          status: "orphaned",
          transactionId: null,
          fileCount: null,
          totalBytes: null,
          diagnostics: ["Backup partial has no manifest"]
        });
      }
      continue;
    }
    try {
      const verified = await verifyBackup(path, { budget });
      records.push({
        path,
        status: "verified",
        transactionId: verified.manifest.transactionId,
        fileCount: verified.files.length,
        totalBytes: verified.files.reduce((sum, file) => sum + file.size, 0),
        diagnostics: []
      });
    } catch (error) {
      if (error instanceof IoBudgetError) {
        throw error;
      }
      records.push({
        path,
        status: "invalid",
        transactionId: null,
        fileCount: null,
        totalBytes: null,
        diagnostics: ["Backup verification failed"]
      });
    }
  }
  return records;
}

async function requireDiscoveredBackup(
  activeVaultPathInput: string,
  candidatePathInput: string
): Promise<{ activeVaultPath: string; record: BackupDiscoveryRecord }> {
  const activeVaultPath = resolvePrivilegedAbsolutePath(activeVaultPathInput);
  const candidatePath = resolvePrivilegedAbsolutePath(candidatePathInput);
  if (sameAbsolutePath(activeVaultPath, candidatePath)) {
    throw new VaultServiceError(
      "BACKUP_NOT_DISCOVERED",
      "The active learning library can never be treated as a backup candidate",
      404
    );
  }
  const record = (await discoverBackups(activeVaultPath)).find(
    (candidate) => sameAbsolutePath(candidate.path, candidatePath)
  );
  if (record === undefined) {
    throw new VaultServiceError(
      "BACKUP_NOT_DISCOVERED",
      "Cleanup is limited to a backup discovered beside the active learning library",
      404
    );
  }
  return { activeVaultPath, record };
}

async function candidateDigests(
  path: string,
  budget: IoBudget = createVaultIoBudget()
): Promise<FileDigest[]> {
  const information = await lstat(path);
  if (information.isSymbolicLink()) {
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Backup export rejects symbolic links and junctions"
    );
  }
  if (information.isDirectory()) {
    return collectDigests(path, { budget });
  }
  if (!information.isFile()) {
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Backup export found an unsupported filesystem entry"
    );
  }
  budget.claimFile(information.size, 0);
  return [
    {
      relativePath: basename(path),
      sha256: await sha256File(path, budget),
      size: information.size
    }
  ];
}

function exportTokenFor(
  record: BackupDiscoveryRecord,
  files: readonly FileDigest[]
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        path: resolve(record.path),
        status: record.status,
        transactionId: record.transactionId,
        files
      }),
      "utf8"
    )
    .digest("hex");
}

export async function exportBackupCandidate(
  activeVaultPathInput: string,
  candidatePathInput: string
): Promise<BackupCandidateExport> {
  const { record } = await requireDiscoveredBackup(
    activeVaultPathInput,
    candidatePathInput
  );
  const files = await candidateDigests(record.path);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: record,
    files,
    exportToken: exportTokenFor(record, files)
  };
}

export async function cleanupBackupCandidate(
  activeVaultPathInput: string,
  candidatePathInput: string,
  exportToken: string,
  options: {
    remove?: (
      path: string,
      options: { force: boolean; recursive: boolean }
    ) => Promise<void>;
  } = {}
): Promise<{
  removedPath: string;
  exportReceipt: BackupCandidateExport;
  health: BackupCleanupHealth;
}> {
  const { activeVaultPath, record } = await requireDiscoveredBackup(
    activeVaultPathInput,
    candidatePathInput
  );
  const exportReceipt = await exportBackupCandidate(
    activeVaultPath,
    record.path
  );
  if (exportReceipt.exportToken !== exportToken) {
    throw new VaultServiceError(
      "BACKUP_EXPORT_REQUIRED",
      "Export the current backup inventory immediately before cleanup",
      409
    );
  }

  const remove = options.remove ?? rm;
  try {
    const information = await lstat(record.path);
    await remove(record.path, {
      force: true,
      recursive: information.isDirectory()
    });
    const companionManifest = `${record.path}.manifest.json`;
    if (await exists(companionManifest)) {
      await remove(companionManifest, { force: true, recursive: false });
    }
  } catch {
    await recordCleanupFailure(activeVaultPath, record.path);
    throw new VaultServiceError(
      "BACKUP_RETENTION_CLEANUP_FAILED",
      "Backup cleanup failed; the failure is available in learning-library health",
      500
    );
  }

  return {
    removedPath: record.path,
    exportReceipt,
    health: await recordCleanupSuccess(activeVaultPath)
  };
}

export async function finalizeInterruptedBackup(
  activeVaultPathInput: string,
  activeVaultId: string,
  partialPathInput: string
): Promise<{ backupPath: string; fileCount: number; totalBytes: number }> {
  const activeVaultPath = resolvePrivilegedAbsolutePath(activeVaultPathInput);
  const partialPath = resolvePrivilegedAbsolutePath(partialPathInput);
  const { record } = await requireDiscoveredBackup(
    activeVaultPath,
    partialPath
  );
  if (record.status !== "verified-needs-finalize") {
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Only a discovered and verified interrupted backup can be finalized"
    );
  }
  const manifestPath = `${partialPath}.manifest.json`;
  const parent = dirname(partialPath);
  const manifest = parseVaultTransferManifest(
    (
      await readBoundedRegularFile(parent, manifestPath, {
        maxBytes: MAX_BACKUP_MANIFEST_BYTES,
        label: "Interrupted backup manifest"
      })
    ).data.toString("utf8")
  );
  if (
    manifest.operation !== "backup" ||
    manifest.completed !== true ||
    manifest.phase !== "ready" ||
    manifest.finalPath === undefined ||
    manifest.sourcePath === undefined
  ) {
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Interrupted backup is not ready to finalize"
    );
  }
  const suffix = `.partial-${manifest.transactionId}`;
  const derivedBackupPath = partialPath.endsWith(suffix)
    ? partialPath.slice(0, -suffix.length)
    : "";
  const backupPath =
    derivedBackupPath.length === 0
      ? ""
      : resolvePrivilegedAbsolutePath(derivedBackupPath);
  if (
    backupPath.length === 0 ||
    !sameAbsolutePath(manifest.finalPath, backupPath) ||
    !sameAbsolutePath(manifest.sourcePath, activeVaultPath) ||
    manifest.sourceVaultId !== activeVaultId ||
    record.transactionId !== manifest.transactionId ||
    !sameAbsolutePath(dirname(backupPath), dirname(activeVaultPath)) ||
    !basename(backupPath).startsWith(BACKUP_PREFIX)
  ) {
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Interrupted backup identity or destination does not match the active learning library"
    );
  }
  const verified = await verifyBackup(partialPath);
  if (JSON.stringify(verified.manifest) !== JSON.stringify(manifest)) {
    throw new VaultServiceError(
      "HASH_VERIFICATION_FAILED",
      "Interrupted backup manifests do not match"
    );
  }
  if (await exists(backupPath)) {
    throw new VaultServiceError(
      "DESTINATION_NOT_EMPTY",
      "Final backup destination already exists",
      409
    );
  }
  await rename(partialPath, backupPath);
  await rm(manifestPath, { force: true });
  return {
    backupPath,
    fileCount: verified.files.length,
    totalBytes: verified.files.reduce((sum, file) => sum + file.size, 0)
  };
}
