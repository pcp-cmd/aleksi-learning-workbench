import { atomicWriteText } from "../lib/atomic-write";
import { rm } from "node:fs/promises";
import { resolveInsideRoot } from "../lib/path-safety";
import { withProcessKeyLock } from "../lib/process-key-lock";
import {
  cleanupJournal,
  listTransactionIds,
  loadJournal,
  persistJournal,
  readTextIfPresent,
  sha256Text
} from "./transaction-journal";
import type {
  TransactionJournal,
  TransactionTarget
} from "./transaction-types";

export type TransactionRecoveryReport = {
  committed: number;
  quarantined: number;
  diagnostics: string[];
};

async function verifiedPayload(
  vaultPath: string,
  relativePath: string,
  expectedSha256: string
): Promise<string | null> {
  const content = await readTextIfPresent(
    resolveInsideRoot(vaultPath, relativePath)
  );
  return content !== null && sha256Text(content) === expectedSha256
    ? content
    : null;
}

async function applyRecoverableTarget(
  vaultPath: string,
  target: TransactionTarget
): Promise<string | null> {
  const absolutePath = resolveInsideRoot(vaultPath, target.relativePath);
  const current = await readTextIfPresent(absolutePath);
  const currentSha = current === null ? null : sha256Text(current);
  if (currentSha === target.newSha256) {
    return null;
  }

  const displacedOldPayload =
    target.displacedPath === null || target.oldSha256 === null
      ? null
      : await verifiedPayload(
          vaultPath,
          target.displacedPath,
          target.oldSha256
        );
  const targetMissingDuringReplacement =
    current === null &&
    target.oldSha256 !== null &&
    target.newSha256 !== null &&
    displacedOldPayload !== null;
  const isOldState = currentSha === target.oldSha256;
  if (!isOldState && !targetMissingDuringReplacement) {
    return `Current file ${target.relativePath} matches neither old nor new hash`;
  }
  if (
    target.oldSha256 !== null &&
    (target.backupPath === null ||
      (await verifiedPayload(
        vaultPath,
        target.backupPath,
        target.oldSha256
      )) === null)
  ) {
    return `Backup payload for ${target.relativePath} is missing or corrupt`;
  }

  if (target.newSha256 === null) {
    await rm(absolutePath);
    return null;
  }
  if (target.temporaryPath === null) {
    return `Temporary payload for ${target.relativePath} is missing`;
  }
  const temporary = await verifiedPayload(
    vaultPath,
    target.temporaryPath,
    target.newSha256
  );
  if (temporary === null) {
    return `Temporary payload for ${target.relativePath} is missing or corrupt`;
  }
  await atomicWriteText(absolutePath, temporary, { root: vaultPath });
  return null;
}

async function quarantine(
  vaultPath: string,
  journal: TransactionJournal,
  diagnostic: string
): Promise<void> {
  const updated: TransactionJournal = {
    ...journal,
    state: "quarantined",
    diagnostics: [...journal.diagnostics, diagnostic],
    updatedAt: new Date().toISOString()
  };
  await persistJournal(vaultPath, updated);
}

export async function recoverJournal(
  vaultPath: string,
  journal: TransactionJournal
): Promise<"committed" | "quarantined"> {
  if (journal.state === "quarantined") {
    return "quarantined";
  }
  if (journal.state === "committed") {
    await cleanupJournal(vaultPath, journal.transactionId);
    return "committed";
  }

  for (const target of journal.targets) {
    const diagnostic = await applyRecoverableTarget(vaultPath, target);
    if (diagnostic !== null) {
      await quarantine(vaultPath, journal, diagnostic);
      return "quarantined";
    }
  }

  await persistJournal(vaultPath, {
    ...journal,
    state: "committed",
    updatedAt: new Date().toISOString()
  });
  await cleanupJournal(vaultPath, journal.transactionId);
  return "committed";
}

export async function recoverTransactionsUnlocked(
  vaultPath: string,
  vaultId: string
): Promise<TransactionRecoveryReport> {
  const report: TransactionRecoveryReport = {
    committed: 0,
    quarantined: 0,
    diagnostics: []
  };
  for (const transactionId of await listTransactionIds(vaultPath)) {
    let journal: TransactionJournal;
    try {
      journal = await loadJournal(vaultPath, transactionId);
    } catch (error) {
      report.quarantined += 1;
      report.diagnostics.push(
        error instanceof Error ? error.message : String(error)
      );
      continue;
    }
    if (journal.vaultId !== vaultId) {
      report.quarantined += 1;
      report.diagnostics.push(
        `Transaction ${transactionId} belongs to another vault`
      );
      continue;
    }
    const result = await recoverJournal(vaultPath, journal);
    report[result] += 1;
    if (result === "quarantined") {
      report.diagnostics.push(
        `Transaction ${transactionId} requires manual recovery`
      );
    }
  }
  return report;
}

export function recoverTransactions(
  vaultPath: string,
  vaultId: string
): Promise<TransactionRecoveryReport> {
  return withProcessKeyLock(`transactions:${vaultPath}`, () =>
    recoverTransactionsUnlocked(vaultPath, vaultId)
  );
}
