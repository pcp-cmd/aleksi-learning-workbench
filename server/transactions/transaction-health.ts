import { createHash } from "node:crypto";
import { z } from "zod";
import { readAssetVersion } from "../lib/asset-version";
import { normalizeVaultRelativePath, resolveInsideRoot } from "../lib/path-safety";
import { withProcessKeyLock } from "../lib/process-key-lock";
import {
  inspectJournalCopies,
  listTransactionDirectoryEntries,
  loadJournal,
  readTextIfPresent,
  sha256Text,
  transactionArtifactRelativePaths
} from "./transaction-journal";
import {
  findArchivedTransactionEntry,
  listArchivedTransactionHealth,
  quarantineTransactionArtifacts
} from "./transaction-quarantine";
import {
  recoverJournal,
  recoverTransactionsUnlocked
} from "./transaction-recovery";
import { runPreparedFileTransactionUnlocked } from "./transaction-runner";
import type {
  TransactionRecoveryAction,
  TransactionHealthRecord,
  TransactionHealthTarget,
  TransactionJournal,
  TransactionTarget
} from "./transaction-types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class TransactionRecoveryError extends Error {
  readonly details: Readonly<{ transactionId: string }>;

  constructor(
    readonly code:
      | "TRANSACTION_NOT_FOUND"
      | "TRANSACTION_ACTION_NOT_ALLOWED"
      | "TRANSACTION_PREVIEW_REQUIRED"
      | "TRANSACTION_RECOVERY_CAS_MISMATCH"
      | "TRANSACTION_RECOVERY_PAYLOAD_INVALID",
    readonly transactionId: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "TransactionRecoveryError";
    this.details = { transactionId };
  }
}

function sanitizeDiagnostic(vaultPath: string, diagnostic: string): string {
  return diagnostic.split(vaultPath).join("[learning-library]");
}

async function payloadIntact(
  vaultPath: string,
  relativePath: string | null,
  expectedSha256: string | null
): Promise<boolean> {
  if (expectedSha256 === null) {
    return relativePath === null;
  }
  if (relativePath === null) {
    return false;
  }
  const content = await readTextIfPresent(
    vaultPath,
    resolveInsideRoot(vaultPath, relativePath)
  );
  return content !== null && sha256Text(content) === expectedSha256;
}

async function healthTarget(
  vaultPath: string,
  target: TransactionTarget
): Promise<TransactionHealthTarget> {
  const current = await readTextIfPresent(
    vaultPath,
    resolveInsideRoot(vaultPath, target.relativePath)
  );
  return {
    relativePath: normalizeVaultRelativePath(target.relativePath),
    oldSha256: target.oldSha256,
    currentSha256: current === null ? null : sha256Text(current),
    newSha256: target.newSha256,
    oldPayloadIntact: await payloadIntact(
      vaultPath,
      target.backupPath,
      target.oldSha256
    ),
    newPayloadIntact: await payloadIntact(
      vaultPath,
      target.temporaryPath,
      target.newSha256
    )
  };
}

function allowedForJournal(
  targets: readonly TransactionHealthTarget[]
): TransactionHealthRecord["allowedActions"] {
  return [
    "retry_recovery",
    "accept_current_external_version",
    ...(targets.every((target) => target.newPayloadIntact)
      ? (["apply_intended_version"] as const)
      : []),
    "export_recovery_bundle"
  ];
}

async function recordForJournal(
  vaultPath: string,
  journal: TransactionJournal
): Promise<TransactionHealthRecord> {
  const targets = await Promise.all(
    journal.targets.map((target) => healthTarget(vaultPath, target))
  );
  return {
    transactionId: journal.transactionId,
    operation: journal.operation,
    state: "quarantined",
    createdAt: journal.createdAt,
    updatedAt: journal.updatedAt,
    targets,
    diagnostics: journal.diagnostics.map((diagnostic) =>
      sanitizeDiagnostic(vaultPath, diagnostic)
    ),
    allowedActions: allowedForJournal(targets)
  };
}

async function activeTransactionIds(vaultPath: string): Promise<string[]> {
  const entries = await listTransactionDirectoryEntries(vaultPath);
  return Array.from(
    new Set(
      entries.flatMap((entry) => {
        const candidate = entry.name.endsWith(".json")
          ? entry.name.slice(0, -".json".length)
          : entry.name.endsWith(".mirror")
            ? entry.name.slice(0, -".mirror".length)
            : null;
        return candidate !== null && UUID.test(candidate) ? [candidate] : [];
      })
    )
  ).sort();
}

export async function getActiveTransactionHealthRecord(
  vaultPath: string,
  transactionId: string
): Promise<TransactionHealthRecord | null> {
  if (!UUID.test(transactionId)) {
    return null;
  }
  const ids = await activeTransactionIds(vaultPath);
  if (!ids.includes(transactionId)) {
    return null;
  }
  const inspection = await inspectJournalCopies(vaultPath, transactionId);
  if (inspection.journal === null) {
    const now = new Date().toISOString();
    return {
      transactionId,
      operation: "unknown",
      state: "unreadable",
      createdAt: null,
      updatedAt: now,
      targets: [],
      diagnostics: inspection.diagnostics.map((diagnostic) =>
        sanitizeDiagnostic(vaultPath, diagnostic)
      ),
      allowedActions: [
        "export_recovery_bundle",
        "remove_unreadable_journal"
      ]
    };
  }
  if (inspection.journal.state !== "quarantined") {
    return null;
  }
  return recordForJournal(vaultPath, inspection.journal);
}

export async function inspectTransactionHealth(
  vaultPath: string
): Promise<{
  blocked: boolean;
  transactions: TransactionHealthRecord[];
}> {
  const active = (
    await Promise.all(
      (await activeTransactionIds(vaultPath)).map((transactionId) =>
        getActiveTransactionHealthRecord(vaultPath, transactionId)
      )
    )
  ).filter((record): record is TransactionHealthRecord => record !== null);
  const archived = await listArchivedTransactionHealth(vaultPath);
  return {
    blocked: active.length > 0,
    transactions: [...active, ...archived]
  };
}

export type ApplyIntendedPreview = Readonly<{
  transactionId: string;
  previewToken: string;
  targets: readonly Readonly<{
    relativePath: string;
    currentSha256: string | null;
    intendedSha256: string | null;
  }>[];
}>;

function previewTokenFor(
  transactionId: string,
  targets: ApplyIntendedPreview["targets"]
): string {
  return createHash("sha256")
    .update(JSON.stringify({ transactionId, targets }), "utf8")
    .digest("hex");
}

export async function previewApplyIntended(
  vaultPath: string,
  transactionId: string
): Promise<ApplyIntendedPreview> {
  const record = await getActiveTransactionHealthRecord(
    vaultPath,
    transactionId
  );
  if (record === null) {
    throw new TransactionRecoveryError(
      "TRANSACTION_NOT_FOUND",
      transactionId,
      "The transaction was not found",
      404
    );
  }
  if (!record.allowedActions.includes("apply_intended_version")) {
    throw new TransactionRecoveryError(
      "TRANSACTION_ACTION_NOT_ALLOWED",
      transactionId,
      "The intended version cannot be applied because its payload is incomplete",
      409
    );
  }
  const targets = record.targets.map((target) => ({
    relativePath: target.relativePath,
    currentSha256: target.currentSha256,
    intendedSha256: target.newSha256
  }));
  return {
    transactionId,
    previewToken: previewTokenFor(transactionId, targets),
    targets
  };
}

export const transactionActionBodySchema = z
  .object({
    action: z.enum([
      "retry_recovery",
      "accept_current_external_version",
      "apply_intended_version",
      "export_recovery_bundle",
      "remove_unreadable_journal"
    ]),
    previewToken: z.string().regex(/^[0-9a-f]{64}$/u).optional()
  })
  .strict();

async function requireActiveRecord(
  vaultPath: string,
  transactionId: string
): Promise<TransactionHealthRecord> {
  const record = await getActiveTransactionHealthRecord(
    vaultPath,
    transactionId
  );
  if (record === null) {
    throw new TransactionRecoveryError(
      "TRANSACTION_NOT_FOUND",
      transactionId,
      "The transaction was not found",
      404
    );
  }
  return record;
}

function requireAllowedAction(
  record: TransactionHealthRecord,
  action: TransactionRecoveryAction
): void {
  if (!record.allowedActions.includes(action)) {
    throw new TransactionRecoveryError(
      "TRANSACTION_ACTION_NOT_ALLOWED",
      record.transactionId,
      `Recovery action ${action} is not allowed for this transaction`,
      409
    );
  }
}

async function intendedTargets(
  vaultPath: string,
  journal: TransactionJournal
) {
  return Promise.all(
    journal.targets.map(async (target) => {
      let content: string | null = null;
      if (target.newSha256 !== null) {
        if (target.temporaryPath === null) {
          throw new TransactionRecoveryError(
            "TRANSACTION_RECOVERY_PAYLOAD_INVALID",
            journal.transactionId,
            `The intended payload for ${target.relativePath} is missing`,
            409
          );
        }
        content = await readTextIfPresent(
          vaultPath,
          resolveInsideRoot(vaultPath, target.temporaryPath)
        );
        if (
          content === null ||
          sha256Text(content) !== target.newSha256
        ) {
          throw new TransactionRecoveryError(
            "TRANSACTION_RECOVERY_PAYLOAD_INVALID",
            journal.transactionId,
            `The intended payload for ${target.relativePath} is incomplete`,
            409
          );
        }
      }
      const absolutePath = resolveInsideRoot(
        vaultPath,
        target.relativePath
      );
      return {
        relativePath: target.relativePath,
        content,
        expectedVersion: await readAssetVersion(absolutePath)
      };
    })
  );
}

export async function resolveTransactionAction(
  vaultPath: string,
  vaultId: string,
  transactionId: string,
  action: TransactionRecoveryAction,
  previewToken?: string
): Promise<
  | { action: TransactionRecoveryAction; blocked: boolean }
  | {
      action: "export_recovery_bundle";
      bundle: TransactionHealthRecord;
    }
> {
  return withProcessKeyLock(`transactions:${vaultPath}`, async () => {
    const activeRecord = await getActiveTransactionHealthRecord(
      vaultPath,
      transactionId
    );
    if (activeRecord === null) {
      const archived = await findArchivedTransactionEntry(
        vaultPath,
        transactionId
      );
      if (
        archived !== null &&
        (action === "export_recovery_bundle" ||
          archived.resolution === action)
      ) {
        if (action === "export_recovery_bundle") {
          return { action, bundle: archived.record };
        }
        return {
          action,
          blocked: (await inspectTransactionHealth(vaultPath)).blocked
        };
      }
    }
    const record =
      activeRecord ?? (await requireActiveRecord(vaultPath, transactionId));
    requireAllowedAction(record, action);

    if (action === "export_recovery_bundle") {
      return { action, bundle: record };
    }

    if (action === "retry_recovery") {
      const journal = await loadJournal(vaultPath, transactionId);
      await recoverJournal(vaultPath, {
        ...journal,
        state: "applying",
        diagnostics: [
          ...journal.diagnostics,
          "Manual recovery retry requested"
        ],
        updatedAt: new Date().toISOString()
      });
      const health = await inspectTransactionHealth(vaultPath);
      return { action, blocked: health.blocked };
    }

    if (
      action === "accept_current_external_version" ||
      action === "remove_unreadable_journal"
    ) {
      await quarantineTransactionArtifacts(
        vaultPath,
        record,
        action,
        transactionArtifactRelativePaths(transactionId)
      );
      const health = await inspectTransactionHealth(vaultPath);
      return { action, blocked: health.blocked };
    }

    if (previewToken === undefined) {
      throw new TransactionRecoveryError(
        "TRANSACTION_PREVIEW_REQUIRED",
        transactionId,
        "Preview the intended recovery immediately before applying it",
        422
      );
    }
    const preview = await previewApplyIntended(vaultPath, transactionId);
    if (preview.previewToken !== previewToken) {
      throw new TransactionRecoveryError(
        "TRANSACTION_RECOVERY_CAS_MISMATCH",
        transactionId,
        "A target changed after the recovery preview; preview it again",
        409
      );
    }
    const journal = await loadJournal(vaultPath, transactionId);
    const targets = await intendedTargets(vaultPath, journal);
    await runPreparedFileTransactionUnlocked({
      vaultPath,
      vaultId,
      operation: `recovery-apply-intended:${journal.operation}`,
      targets
    });
    await quarantineTransactionArtifacts(
      vaultPath,
      record,
      action,
      transactionArtifactRelativePaths(transactionId)
    );
    const recovery = await recoverTransactionsUnlocked(vaultPath, vaultId);
    return {
      action,
      blocked: recovery.quarantined > 0
    };
  });
}
