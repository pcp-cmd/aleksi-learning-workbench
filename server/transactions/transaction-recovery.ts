import { atomicWriteText } from "../lib/atomic-write";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolveInsideRoot } from "../lib/path-safety";
import { withProcessKeyLock } from "../lib/process-key-lock";
import {
  cleanupJournal,
  inspectJournalCopies,
  listTransactionDirectoryEntries,
  listTransactionIds,
  loadJournal,
  persistJournal,
  readTextIfPresent,
  sha256Text,
  transactionArtifactRelativePaths
} from "./transaction-journal";
import { quarantineTransactionArtifacts } from "./transaction-quarantine";
import type {
  TransactionJournal,
  TransactionTarget
} from "./transaction-types";

export type TransactionRecoveryReport = {
  committed: number;
  quarantined: number;
  diagnostics: string[];
  blockingTransactionIds?: string[];
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function scavengeTransactionArtifacts(
  vaultPath: string
): Promise<string[]> {
  const entries = await listTransactionDirectoryEntries(vaultPath);
  const journalIds = new Set(
    entries.flatMap((entry) => {
      const candidate = entry.name.endsWith(".json")
        ? entry.name.slice(0, -".json".length)
        : entry.name.endsWith(".mirror")
          ? entry.name.slice(0, -".mirror".length)
          : null;
      return candidate !== null && UUID.test(candidate) ? [candidate] : [];
    })
  );
  const payloadIds = new Set(
    entries
      .filter((entry) => entry.isDirectory && UUID.test(entry.name))
      .map((entry) => entry.name)
  );
  const diagnostics: string[] = [];
  for (const entry of entries) {
    if (
      entry.isDirectory &&
      UUID.test(entry.name) &&
      !journalIds.has(entry.name)
    ) {
      const now = new Date().toISOString();
      await quarantineTransactionArtifacts(
        vaultPath,
        {
          transactionId: entry.name,
          operation: "unknown",
          state: "orphaned",
          createdAt: null,
          updatedAt: now,
          targets: [],
          diagnostics: [
            "A transaction payload directory existed without a readable journal reference"
          ],
          allowedActions: ["export_recovery_bundle"]
        },
        "orphan_scavenged",
        [`.aleksi/transactions/${entry.name}`]
      );
      diagnostics.push(`Transaction ${entry.name} payload orphan was archived`);
      continue;
    }
    if (
      entry.isFile &&
      (entry.name.includes(".tmp-") || entry.name.includes(".bak-"))
    ) {
      const transactionId = randomUUID();
      const now = new Date().toISOString();
      await quarantineTransactionArtifacts(
        vaultPath,
        {
          transactionId,
          operation: "unknown",
          state: "orphaned",
          createdAt: null,
          updatedAt: now,
          targets: [],
          diagnostics: ["A stale transaction replacement artifact was found"],
          allowedActions: ["export_recovery_bundle"]
        },
        "stale_replacement_artifact_scavenged",
        [`.aleksi/transactions/${entry.name}`]
      );
      diagnostics.push(`Stale transaction artifact ${entry.name} was archived`);
    }
  }
  for (const transactionId of journalIds) {
    if (payloadIds.has(transactionId)) {
      continue;
    }
    const inspection = await inspectJournalCopies(vaultPath, transactionId);
    if (inspection.journal === null) {
      continue;
    }
    const now = new Date().toISOString();
    await quarantineTransactionArtifacts(
      vaultPath,
      {
        transactionId,
        operation: inspection.journal.operation,
        state: "orphaned",
        createdAt: inspection.journal.createdAt,
        updatedAt: now,
        targets: await Promise.all(
          inspection.journal.targets.map(async (target) => {
            const current = await readTextIfPresent(
              vaultPath,
              resolveInsideRoot(vaultPath, target.relativePath)
            );
            return {
              relativePath: target.relativePath,
              oldSha256: target.oldSha256,
              currentSha256:
                current === null ? null : sha256Text(current),
              newSha256: target.newSha256,
              oldPayloadIntact: target.oldSha256 === null,
              newPayloadIntact: target.newSha256 === null
            };
          })
        ),
        diagnostics: [
          "A readable transaction journal existed without its payload directory"
        ],
        allowedActions: ["export_recovery_bundle"]
      },
      "journal_without_payload_scavenged",
      transactionArtifactRelativePaths(transactionId)
    );
    diagnostics.push(
      `Transaction ${transactionId} journal without payload was archived`
    );
  }
  return diagnostics;
}

async function verifiedPayload(
  vaultPath: string,
  relativePath: string,
  expectedSha256: string
): Promise<string | null> {
  const content = await readTextIfPresent(
    vaultPath,
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
  const current = await readTextIfPresent(vaultPath, absolutePath);
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
  report.diagnostics.push(...(await scavengeTransactionArtifacts(vaultPath)));
  const blockingTransactionIds: string[] = [];
  for (const transactionId of await listTransactionIds(vaultPath)) {
    let journal: TransactionJournal;
    try {
      journal = await loadJournal(vaultPath, transactionId);
    } catch (error) {
      report.quarantined += 1;
      blockingTransactionIds.push(transactionId);
      report.diagnostics.push(
        error instanceof Error ? error.message : String(error)
      );
      continue;
    }
    if (journal.vaultId !== vaultId) {
      report.quarantined += 1;
      blockingTransactionIds.push(transactionId);
      report.diagnostics.push(
        `Transaction ${transactionId} belongs to another vault`
      );
      continue;
    }
    const result = await recoverJournal(vaultPath, journal);
    report[result] += 1;
    if (result === "quarantined") {
      blockingTransactionIds.push(transactionId);
      report.diagnostics.push(
        `Transaction ${transactionId} requires manual recovery`
      );
    }
  }
  if (blockingTransactionIds.length > 0) {
    report.blockingTransactionIds = Array.from(
      new Set(blockingTransactionIds)
    ).sort();
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
