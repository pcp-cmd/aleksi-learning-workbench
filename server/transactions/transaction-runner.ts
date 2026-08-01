import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  assetVersionsEqual,
  assertAssetVersion,
  readAssetVersion
} from "../lib/asset-version";
import { atomicWriteText } from "../lib/atomic-write";
import {
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "../lib/path-safety";
import { withProcessKeyLock } from "../lib/process-key-lock";
import type { FaultController } from "../testing/fault-controller";
import {
  cleanupJournal,
  ensureTransactionPayloadDirectory,
  persistJournal,
  readTextIfPresent,
  sha256Text,
  TRANSACTION_DIRECTORY,
  writeTransactionPayload
} from "./transaction-journal";
import { recoverTransactionsUnlocked } from "./transaction-recovery";
import type {
  FileTransactionTargetInput,
  TransactionJournal,
  TransactionTarget
} from "./transaction-types";

export class TransactionQuarantinedError extends Error {
  readonly code = "TRANSACTION_QUARANTINED";
  readonly status = 409;
  readonly details: Readonly<{ transactionId: string }>;

  constructor(
    readonly transactionId: string,
    message: string
  ) {
    super(message);
    this.name = "TransactionQuarantinedError";
    this.details = { transactionId };
  }
}

export class DuplicateTransactionTargetError extends Error {
  readonly code = "DUPLICATE_TRANSACTION_TARGET";
  readonly status = 422;

  constructor(readonly relativePath: string) {
    super(`Transaction target ${relativePath} appears more than once`);
    this.name = "DuplicateTransactionTargetError";
  }
}

export type RunFileTransactionOptions = {
  vaultPath: string;
  vaultId: string;
  operation: string;
  targets: FileTransactionTargetInput[];
  faults?: FaultController;
  assertCurrent?: () => void;
};

function preflightTransactionOptions(
  options: RunFileTransactionOptions
): RunFileTransactionOptions {
  if (options.targets.length === 0) {
    throw new Error("A file transaction requires at least one target");
  }
  const seen = new Set<string>();
  const targets = options.targets.map((target) => {
    const relativePath = normalizeVaultRelativePath(target.relativePath);
    if (seen.has(relativePath)) {
      throw new DuplicateTransactionTargetError(relativePath);
    }
    seen.add(relativePath);
    return { ...target, relativePath };
  });
  return { ...options, targets };
}

async function prepareTarget(
  options: RunFileTransactionOptions,
  transactionId: string,
  input: FileTransactionTargetInput,
  index: number
): Promise<TransactionTarget> {
  const relativePath = normalizeVaultRelativePath(input.relativePath);
  const absolutePath = resolveInsideRoot(options.vaultPath, relativePath);
  if (input.expectedVersion !== undefined) {
    await assertAssetVersion(
      absolutePath,
      relativePath,
      input.expectedVersion
    );
  }
  const oldContent = await readTextIfPresent(options.vaultPath, absolutePath);
  const dataDirectory = `${TRANSACTION_DIRECTORY}/${transactionId}`;
  if (index === 0) {
    await ensureTransactionPayloadDirectory(
      options.vaultPath,
      transactionId
    );
  }
  const newContent = input.content;
  const temporaryPath =
    newContent === null ? null : `${dataDirectory}/${index}.new`;
  if (temporaryPath !== null && newContent !== null) {
    await writeTransactionPayload(
      options.vaultPath,
      temporaryPath,
      newContent
    );
  }
  let backupPath: string | null = null;
  if (oldContent !== null) {
    backupPath = `${dataDirectory}/${index}.old`;
    await writeTransactionPayload(options.vaultPath, backupPath, oldContent);
  }
  return {
    relativePath,
    oldSha256: oldContent === null ? null : sha256Text(oldContent),
    newSha256: newContent === null ? null : sha256Text(newContent),
    temporaryPath,
    backupPath,
    displacedPath:
      oldContent !== null && newContent !== null
        ? `${dataDirectory}/${index}.displaced`
        : null
  };
}

async function markQuarantined(
  options: RunFileTransactionOptions,
  journal: TransactionJournal,
  diagnostic: string
): Promise<never> {
  await persistJournal(options.vaultPath, {
    ...journal,
    state: "quarantined",
    diagnostics: [...journal.diagnostics, diagnostic],
    updatedAt: new Date().toISOString()
  });
  throw new TransactionQuarantinedError(
    journal.transactionId,
    diagnostic
  );
}

async function applyTarget(
  options: RunFileTransactionOptions,
  journal: TransactionJournal,
  target: TransactionTarget,
  content: string | null
): Promise<void> {
  const absolutePath = resolveInsideRoot(options.vaultPath, target.relativePath);
  const current = await readTextIfPresent(options.vaultPath, absolutePath);
  const currentSha = current === null ? null : sha256Text(current);
  if (currentSha === target.newSha256) {
    return;
  }
  if (currentSha !== target.oldSha256) {
    await markQuarantined(
      options,
      journal,
      `Current file ${target.relativePath} changed outside this transaction`
    );
  }
  const input = options.targets.find(
    (candidate) =>
      normalizeVaultRelativePath(candidate.relativePath) === target.relativePath
  );
  if (input?.expectedVersion !== undefined) {
    const currentVersion = await readAssetVersion(absolutePath);
    if (
      currentSha !== target.newSha256 &&
      !assetVersionsEqual(currentVersion, input.expectedVersion)
    ) {
      await markQuarantined(
        options,
        journal,
        `Current file ${target.relativePath} no longer matches its expected version`
      );
    }
  }
  options.assertCurrent?.();
  if (content === null) {
    await rm(absolutePath);
  } else {
    await atomicWriteText(absolutePath, content, {
      root: options.vaultPath,
      fallbackDisplacedPath:
        target.displacedPath === null
          ? undefined
          : resolveInsideRoot(options.vaultPath, target.displacedPath)
    });
  }
}

async function runPreparedTransaction(
  options: RunFileTransactionOptions,
  transactionId: string
): Promise<{ transactionId: string }> {
  const createdAt = new Date().toISOString();
  const targets: TransactionTarget[] = [];
  for (const [index, target] of options.targets.entries()) {
    targets.push(await prepareTarget(options, transactionId, target, index));
  }
  await options.faults?.boundary(
    "transaction:after-payload-prepare-before-journal"
  );
  let journal: TransactionJournal = {
    schemaVersion: 1,
    transactionId,
    vaultId: options.vaultId,
    operation: options.operation,
    state: "prepared",
    targets,
    diagnostics: [],
    createdAt,
    updatedAt: createdAt
  };
  await persistJournal(options.vaultPath, journal);
  await options.faults?.boundary("transaction:after-prepare");

  journal = {
    ...journal,
    state: "applying",
    updatedAt: new Date().toISOString()
  };
  await persistJournal(options.vaultPath, journal);
  for (const [index, target] of targets.entries()) {
    await options.faults?.boundary(`transaction:before-target:${index}`);
    await applyTarget(options, journal, target, options.targets[index]!.content);
    await options.faults?.boundary(`transaction:after-target:${index}`);
  }

  options.assertCurrent?.();
  journal = {
    ...journal,
    state: "committed",
    updatedAt: new Date().toISOString()
  };
  await persistJournal(options.vaultPath, journal);
  await cleanupJournal(options.vaultPath, transactionId);
  return { transactionId };
}

export async function runFileTransaction(
  options: RunFileTransactionOptions
): Promise<{ transactionId: string }> {
  const preparedOptions = preflightTransactionOptions(options);
  return withProcessKeyLock(
    `transactions:${preparedOptions.vaultPath}`,
    async () => {
      const recovery = await recoverTransactionsUnlocked(
        preparedOptions.vaultPath,
        preparedOptions.vaultId
      );
      if (recovery.quarantined > 0) {
        throw new TransactionQuarantinedError(
          recovery.blockingTransactionIds?.[0] ?? "recovery",
          "A quarantined transaction must be resolved before another write"
        );
      }
      return runPreparedFileTransactionUnlocked(preparedOptions);
    }
  );
}

export function runPreparedFileTransactionUnlocked(
  options: RunFileTransactionOptions
): Promise<{ transactionId: string }> {
  const preparedOptions = preflightTransactionOptions(options);
  return runPreparedTransaction(preparedOptions, randomUUID());
}
