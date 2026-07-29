import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, opendir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { atomicWriteText } from "./atomic-write";
import { readBoundedRegularFile } from "./bounded-regular-file";
import { hasErrorCode } from "./error-code";
import { IoBudget } from "./io-budget";
import {
  assertRealPathInsideRoot,
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "./path-safety";

export const quarantineCategorySchema = z.enum([
  "transactions",
  "projections",
  "verification",
  "app-settings-diagnostics"
]);
export type QuarantineCategory = z.infer<typeof quarantineCategorySchema>;

const quarantineManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    category: quarantineCategorySchema,
    originalRelativePath: z.string().min(1),
    reasonCode: z.string().regex(/^[A-Z0-9_]+$/u),
    archivedAt: z.string().datetime({ offset: true }),
    artifactName: z.literal("artifact")
  })
  .strict();

export type QuarantineManifest = z.infer<typeof quarantineManifestSchema>;
const MAX_INVENTORY_RECORDS = 256;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_RETENTION_FILES = 4_096;
const MAX_RETENTION_DEPTH = 64;
const MAX_RETENTION_FILE_BYTES = 512 * 1024 * 1024;
const MAX_RETENTION_TOTAL_BYTES = 1024 * 1024 * 1024;
const QUARANTINE_CLEANUP_HEALTH =
  ".aleksi/health/quarantine-cleanup.json";

const quarantineCleanupHealthSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["healthy", "failed"]),
    attempts: z.number().int().nonnegative(),
    lastFailureAt: z.string().datetime({ offset: true }).nullable(),
    lastSuccessfulCleanupAt: z.string().datetime({ offset: true }).nullable(),
    category: z
      .literal("QUARANTINE_RETENTION_CLEANUP_FAILED")
      .nullable(),
    candidateRelativePath: z.string().min(1).nullable(),
    updatedAt: z.string().datetime({ offset: true })
  })
  .strict();

export type QuarantineCleanupHealth = z.infer<
  typeof quarantineCleanupHealthSchema
>;
const quarantineCleanupHealthMemory = new Map<
  string,
  QuarantineCleanupHealth
>();

export type QuarantineRetentionCandidate = Readonly<{
  relativePath: string;
  category: QuarantineCategory;
  bundleName: string;
}>;

export type QuarantineRetentionExport = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  candidate: QuarantineRetentionCandidate;
  files: readonly Readonly<{
    relativePath: string;
    sha256: string;
    size: number;
  }>[];
  exportToken: string;
}>;

export class QuarantineRetentionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "QuarantineRetentionError";
    this.code = code;
    this.status = status;
  }
}

function quarantineExportBudget(): IoBudget {
  return new IoBudget({
    maxDepth: MAX_RETENTION_DEPTH,
    maxFiles: MAX_RETENTION_FILES,
    maxFileBytes: MAX_RETENTION_FILE_BYTES,
    maxTotalBytes: MAX_RETENTION_TOTAL_BYTES,
    maxConcurrency: 1,
    deadlineAt: Date.now() + 5 * 60 * 1000
  });
}

async function boundedLatestEntryNames(
  directoryPath: string,
  budget: IoBudget
): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of await opendir(directoryPath)) {
    budget.claimFile(0, 0);
    names.push(entry.name);
    names.sort((left, right) => left.localeCompare(right));
    if (names.length > MAX_INVENTORY_RECORDS) {
      names.shift();
    }
  }
  return names;
}

async function persistQuarantineCleanupHealth(
  vaultPath: string,
  health: QuarantineCleanupHealth
): Promise<void> {
  quarantineCleanupHealthMemory.set(resolve(vaultPath), health);
  await atomicWriteText(
    resolveInsideRoot(vaultPath, QUARANTINE_CLEANUP_HEALTH),
    `${JSON.stringify(quarantineCleanupHealthSchema.parse(health), null, 2)}\n`,
    { root: vaultPath }
  );
}

export async function readQuarantineCleanupHealth(
  vaultPath: string
): Promise<QuarantineCleanupHealth | null> {
  try {
    const raw = (
      await readBoundedRegularFile(
        vaultPath,
        resolveInsideRoot(vaultPath, QUARANTINE_CLEANUP_HEALTH),
        {
          maxBytes: MAX_MANIFEST_BYTES,
          label: "Quarantine cleanup health"
        }
      )
    ).data.toString("utf8");
    const parsed = quarantineCleanupHealthSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // A memory copy keeps the failure visible if durable health cannot be written.
  }
  return quarantineCleanupHealthMemory.get(resolve(vaultPath)) ?? null;
}

async function recordQuarantineCleanupFailure(
  vaultPath: string,
  candidateRelativePath: string
): Promise<QuarantineCleanupHealth> {
  const previous = await readQuarantineCleanupHealth(vaultPath);
  const now = new Date().toISOString();
  const health = quarantineCleanupHealthSchema.parse({
    schemaVersion: 1,
    status: "failed",
    attempts: (previous?.attempts ?? 0) + 1,
    lastFailureAt: now,
    lastSuccessfulCleanupAt: previous?.lastSuccessfulCleanupAt ?? null,
    category: "QUARANTINE_RETENTION_CLEANUP_FAILED",
    candidateRelativePath,
    updatedAt: now
  });
  await persistQuarantineCleanupHealth(vaultPath, health).catch(
    () => undefined
  );
  return health;
}

async function recordQuarantineCleanupSuccess(
  vaultPath: string
): Promise<QuarantineCleanupHealth> {
  const now = new Date().toISOString();
  const health = quarantineCleanupHealthSchema.parse({
    schemaVersion: 1,
    status: "healthy",
    attempts: 0,
    lastFailureAt: null,
    lastSuccessfulCleanupAt: now,
    category: null,
    candidateRelativePath: null,
    updatedAt: now
  });
  await persistQuarantineCleanupHealth(vaultPath, health).catch(
    () => undefined
  );
  return health;
}

function timestampSegment(value: string): string {
  return value.replace(/[-:.TZ]/gu, "");
}

export async function quarantineVaultPath(
  vaultPath: string,
  category: QuarantineCategory,
  sourceRelativePath: string,
  reasonCode: string
): Promise<QuarantineManifest | null> {
  const parsedCategory = quarantineCategorySchema.parse(category);
  const relativePath = normalizeVaultRelativePath(sourceRelativePath);
  const source = resolveInsideRoot(vaultPath, relativePath);
  try {
    await lstat(source);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  await assertRealPathInsideRoot(vaultPath, source);

  const archivedAt = new Date().toISOString();
  const id = randomUUID();
  const bundleRelativePath = normalizeVaultRelativePath(
    `.aleksi/quarantine/${parsedCategory}/${timestampSegment(archivedAt)}-${id}`
  );
  const bundle = resolveInsideRoot(vaultPath, bundleRelativePath);
  await assertRealPathInsideRoot(vaultPath, dirname(bundle));
  await mkdir(bundle, { recursive: true });
  await assertRealPathInsideRoot(vaultPath, bundle);
  await rename(source, resolveInsideRoot(vaultPath, `${bundleRelativePath}/artifact`));

  const manifest = quarantineManifestSchema.parse({
    schemaVersion: 1,
    id,
    category: parsedCategory,
    originalRelativePath: relativePath,
    reasonCode,
    archivedAt,
    artifactName: "artifact"
  });
  await atomicWriteText(
    resolveInsideRoot(vaultPath, `${bundleRelativePath}/manifest.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { root: vaultPath }
  );
  return manifest;
}

export async function listQuarantineInventory(
  vaultPath: string,
  category: QuarantineCategory
): Promise<QuarantineManifest[]> {
  const parsedCategory = quarantineCategorySchema.parse(category);
  const categoryRoot = resolveInsideRoot(
    vaultPath,
    `.aleksi/quarantine/${parsedCategory}`
  );
  let entries: string[];
  const budget = quarantineExportBudget();
  try {
    entries = await boundedLatestEntryNames(categoryRoot, budget);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  const manifests: QuarantineManifest[] = [];
  for (const entry of entries) {
    budget.checkpoint();
    try {
      const raw = (
        await readBoundedRegularFile(
          vaultPath,
          resolveInsideRoot(
            vaultPath,
            `.aleksi/quarantine/${parsedCategory}/${entry}/manifest.json`
          ),
          {
            maxBytes: MAX_MANIFEST_BYTES,
            label: "Quarantine manifest"
          }
        )
      ).data.toString("utf8");
      const parsed = quarantineManifestSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        manifests.push(parsed.data);
      }
    } catch {
      // A damaged quarantine bundle is evidence, not an active-data record.
    }
  }
  return manifests;
}

export async function listQuarantineRetentionCandidates(
  vaultPath: string
): Promise<QuarantineRetentionCandidate[]> {
  const candidates: QuarantineRetentionCandidate[] = [];
  const budget = quarantineExportBudget();
  for (const category of quarantineCategorySchema.options) {
    const categoryRelativePath = `.aleksi/quarantine/${category}`;
    const categoryRoot = resolveInsideRoot(vaultPath, categoryRelativePath);
    let entries: string[];
    try {
      entries = await boundedLatestEntryNames(categoryRoot, budget);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      budget.checkpoint();
      const relativePath = normalizeVaultRelativePath(
        `${categoryRelativePath}/${entry}`
      );
      const candidatePath = resolveInsideRoot(vaultPath, relativePath);
      let information;
      try {
        information = await lstat(candidatePath);
      } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
          continue;
        }
        throw error;
      }
      if (
        information.isSymbolicLink() ||
        !information.isDirectory()
      ) {
        continue;
      }
      await assertRealPathInsideRoot(vaultPath, candidatePath);
      candidates.push({
        relativePath,
        category,
        bundleName: entry
      });
    }
  }
  return candidates.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

async function requireQuarantineRetentionCandidate(
  vaultPath: string,
  relativePathInput: string
): Promise<QuarantineRetentionCandidate> {
  const relativePath = normalizeVaultRelativePath(relativePathInput);
  const candidate = (await listQuarantineRetentionCandidates(vaultPath)).find(
    (entry) => entry.relativePath === relativePath
  );
  if (candidate === undefined) {
    throw new QuarantineRetentionError(
      "QUARANTINE_NOT_DISCOVERED",
      "Cleanup is limited to a currently discovered quarantine bundle",
      404
    );
  }
  return candidate;
}

async function sha256File(path: string, budget: IoBudget): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    budget.checkpoint();
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function collectQuarantineDigests(
  vaultPath: string,
  candidate: QuarantineRetentionCandidate
): Promise<QuarantineRetentionExport["files"]> {
  const candidateRoot = resolveInsideRoot(vaultPath, candidate.relativePath);
  const budget = quarantineExportBudget();
  const files: Array<{
    relativePath: string;
    sha256: string;
    size: number;
  }> = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    budget.checkpoint();
    if (depth > budget.limits.maxDepth) {
      budget.claimFile(0, depth);
    }
    await assertRealPathInsideRoot(vaultPath, directory);
    for await (const entry of await opendir(directory)) {
      const absolutePath = resolveInsideRoot(
        vaultPath,
        normalizeVaultRelativePath(
          relative(vaultPath, join(directory, entry.name))
            .split("\\")
            .join("/")
        )
      );
      const information = await lstat(absolutePath);
      if (information.isSymbolicLink()) {
        throw new QuarantineRetentionError(
          "QUARANTINE_EXPORT_UNSAFE_ENTRY",
          "Quarantine export rejects symbolic links and junctions"
        );
      }
      if (information.isDirectory()) {
        budget.claimFile(0, depth + 1);
        await visit(absolutePath, depth + 1);
        continue;
      }
      if (!information.isFile()) {
        throw new QuarantineRetentionError(
          "QUARANTINE_EXPORT_UNSAFE_ENTRY",
          "Quarantine export found an unsupported filesystem entry"
        );
      }
      budget.claimFile(information.size, depth);
      files.push({
        relativePath: normalizeVaultRelativePath(
          relative(candidateRoot, absolutePath).split("\\").join("/")
        ),
        sha256: await sha256File(absolutePath, budget),
        size: information.size
      });
    }
  };
  await visit(candidateRoot, 0);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

function quarantineExportToken(
  candidate: QuarantineRetentionCandidate,
  files: QuarantineRetentionExport["files"]
): string {
  return createHash("sha256")
    .update(JSON.stringify({ candidate, files }), "utf8")
    .digest("hex");
}

export async function exportQuarantineRetentionCandidate(
  vaultPath: string,
  relativePath: string
): Promise<QuarantineRetentionExport> {
  const candidate = await requireQuarantineRetentionCandidate(
    vaultPath,
    relativePath
  );
  const files = await collectQuarantineDigests(vaultPath, candidate);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate,
    files,
    exportToken: quarantineExportToken(candidate, files)
  };
}

export async function cleanupQuarantineRetentionCandidate(
  vaultPath: string,
  relativePath: string,
  exportToken: string,
  options: {
    remove?: (
      path: string,
      options: { force: boolean; recursive: boolean }
    ) => Promise<void>;
  } = {}
): Promise<{
  removedRelativePath: string;
  exportReceipt: QuarantineRetentionExport;
  health: QuarantineCleanupHealth;
}> {
  const exportReceipt = await exportQuarantineRetentionCandidate(
    vaultPath,
    relativePath
  );
  if (exportReceipt.exportToken !== exportToken) {
    throw new QuarantineRetentionError(
      "QUARANTINE_EXPORT_REQUIRED",
      "Export the current quarantine inventory immediately before cleanup",
      409
    );
  }
  const candidateRoot = resolveInsideRoot(
    vaultPath,
    exportReceipt.candidate.relativePath
  );
  await assertRealPathInsideRoot(vaultPath, candidateRoot);
  try {
    await (options.remove ?? rm)(candidateRoot, {
      force: true,
      recursive: true
    });
  } catch {
    await recordQuarantineCleanupFailure(
      vaultPath,
      exportReceipt.candidate.relativePath
    );
    throw new QuarantineRetentionError(
      "QUARANTINE_RETENTION_CLEANUP_FAILED",
      "Quarantine cleanup failed; the failure is available in learning-library health",
      500
    );
  }
  return {
    removedRelativePath: exportReceipt.candidate.relativePath,
    exportReceipt,
    health: await recordQuarantineCleanupSuccess(vaultPath)
  };
}
