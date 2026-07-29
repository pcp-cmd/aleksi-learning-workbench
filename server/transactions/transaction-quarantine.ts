import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { atomicWriteText } from "../lib/atomic-write";
import { readBoundedRegularFile } from "../lib/bounded-regular-file";
import { hasErrorCode } from "../lib/error-code";
import {
  assertRealPathInsideRoot,
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "../lib/path-safety";
import {
  transactionRecoveryActionSchema,
  type TransactionHealthRecord
} from "./transaction-types";

export const TRANSACTION_QUARANTINE_DIRECTORY =
  ".aleksi/quarantine/transactions";
const MAX_QUARANTINE_MANIFEST_BYTES = 256 * 1024;
const MAX_QUARANTINE_RECORDS = 256;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const healthTargetSchema = z
  .object({
    relativePath: z.string().min(1),
    oldSha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
    currentSha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
    newSha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
    oldPayloadIntact: z.boolean(),
    newPayloadIntact: z.boolean()
  })
  .strict();

const quarantineManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    transactionId: z.string().uuid(),
    operation: z.string().min(1),
    state: z.enum(["quarantined", "unreadable", "orphaned"]),
    createdAt: z.string().datetime({ offset: true }).nullable(),
    updatedAt: z.string().datetime({ offset: true }),
    targets: z.array(healthTargetSchema).max(64),
    diagnostics: z.array(z.string().max(2_048)).max(64),
    allowedActions: z.array(transactionRecoveryActionSchema).max(5),
    resolution: z.string().min(1),
    archivedAt: z.string().datetime({ offset: true }),
    artifacts: z.array(z.string().min(1)).max(16)
  })
  .strict();

type QuarantineManifest = z.infer<typeof quarantineManifestSchema>;
export type ArchivedTransactionEntry = Readonly<{
  record: TransactionHealthRecord;
  resolution: string;
}>;

function assertTransactionId(transactionId: string): void {
  if (!UUID.test(transactionId)) {
    throw new Error("Transaction ID must be a UUID");
  }
}

function timestampSegment(now: string): string {
  return now.replace(/[-:.TZ]/gu, "");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

export async function quarantineTransactionArtifacts(
  vaultPath: string,
  record: TransactionHealthRecord,
  resolution: string,
  artifactRelativePaths: readonly string[]
): Promise<{ bundleRelativePath: string }> {
  assertTransactionId(record.transactionId);
  const archivedAt = new Date().toISOString();
  const bundleRelativePath = normalizeVaultRelativePath(
    `${TRANSACTION_QUARANTINE_DIRECTORY}/${timestampSegment(archivedAt)}-${record.transactionId}-${randomUUID()}`
  );
  const bundlePath = resolveInsideRoot(vaultPath, bundleRelativePath);
  await assertRealPathInsideRoot(vaultPath, dirname(bundlePath));
  await mkdir(bundlePath, { recursive: true });
  await assertRealPathInsideRoot(vaultPath, bundlePath);

  const artifacts: string[] = [];
  for (const [index, rawRelativePath] of artifactRelativePaths.entries()) {
    const relativePath = normalizeVaultRelativePath(rawRelativePath);
    const source = resolveInsideRoot(vaultPath, relativePath);
    if (!(await pathExists(source))) {
      continue;
    }
    await assertRealPathInsideRoot(vaultPath, source);
    const name = `${index}-${relativePath.split("/").at(-1) ?? "artifact"}`;
    const destinationRelativePath = `${bundleRelativePath}/${name}`;
    const destination = resolveInsideRoot(vaultPath, destinationRelativePath);
    await rename(source, destination);
    artifacts.push(name);
  }

  const manifest: QuarantineManifest = quarantineManifestSchema.parse({
    schemaVersion: 1,
    ...record,
    allowedActions:
      record.state === "orphaned"
        ? ["export_recovery_bundle"]
        : [],
    resolution,
    archivedAt,
    artifacts
  });
  await atomicWriteText(
    resolveInsideRoot(vaultPath, `${bundleRelativePath}/manifest.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { root: vaultPath }
  );
  return { bundleRelativePath };
}

export async function listArchivedTransactionHealth(
  vaultPath: string
): Promise<TransactionHealthRecord[]> {
  return (await listArchivedTransactionEntries(vaultPath)).map(
    (entry) => entry.record
  );
}

export async function listArchivedTransactionEntries(
  vaultPath: string
): Promise<ArchivedTransactionEntry[]> {
  const root = resolveInsideRoot(vaultPath, TRANSACTION_QUARANTINE_DIRECTORY);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  const records: ArchivedTransactionEntry[] = [];
  for (const entry of entries.sort().slice(-MAX_QUARANTINE_RECORDS)) {
    let raw: Buffer;
    try {
      raw = (
        await readBoundedRegularFile(
          vaultPath,
          resolveInsideRoot(
            vaultPath,
            `${TRANSACTION_QUARANTINE_DIRECTORY}/${entry}/manifest.json`
          ),
          {
            maxBytes: MAX_QUARANTINE_MANIFEST_BYTES,
            label: "Transaction quarantine manifest"
          }
        )
      ).data;
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      continue;
    }
    const manifest = quarantineManifestSchema.safeParse(parsed);
    if (!manifest.success) {
      continue;
    }
    const { resolution: _resolution, archivedAt: _archivedAt, artifacts: _artifacts, schemaVersion: _schemaVersion, ...record } =
      manifest.data;
    records.push({
      record,
      resolution: manifest.data.resolution
    });
  }
  return records;
}

export async function findArchivedTransactionEntry(
  vaultPath: string,
  transactionId: string
): Promise<ArchivedTransactionEntry | null> {
  const entries = await listArchivedTransactionEntries(vaultPath);
  return (
    entries
      .filter((entry) => entry.record.transactionId === transactionId)
      .at(-1) ?? null
  );
}
