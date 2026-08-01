import { z } from "zod";
import type { AssetVersion } from "../lib/asset-version";

export const transactionStateSchema = z.enum([
  "prepared",
  "applying",
  "committed",
  "rolling-back",
  "quarantined"
]);

export type TransactionState = z.infer<typeof transactionStateSchema>;

export const transactionTargetSchema = z
  .object({
    relativePath: z.string().min(1),
    oldSha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
    newSha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
    temporaryPath: z.string().min(1).nullable(),
    backupPath: z.string().min(1).nullable(),
    displacedPath: z.string().min(1).nullable().default(null)
  })
  .strict();

export type TransactionTarget = z.infer<typeof transactionTargetSchema>;

export const transactionJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    transactionId: z.string().uuid(),
    vaultId: z.string().min(1),
    operation: z.string().min(1),
    state: transactionStateSchema,
    targets: z.array(transactionTargetSchema).min(1),
    diagnostics: z.array(z.string()),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true })
  })
  .strict();

export type TransactionJournal = z.infer<typeof transactionJournalSchema>;

export type FileTransactionTargetInput = {
  relativePath: string;
  content: string | null;
  expectedVersion?: AssetVersion | null;
};

export const transactionRecoveryActionSchema = z.enum([
  "retry_recovery",
  "accept_current_external_version",
  "apply_intended_version",
  "export_recovery_bundle",
  "remove_unreadable_journal"
]);

export type TransactionRecoveryAction = z.infer<
  typeof transactionRecoveryActionSchema
>;

export type TransactionHealthTarget = Readonly<{
  relativePath: string;
  oldSha256: string | null;
  currentSha256: string | null;
  newSha256: string | null;
  oldPayloadIntact: boolean;
  newPayloadIntact: boolean;
}>;

export type TransactionHealthRecord = Readonly<{
  transactionId: string;
  operation: string;
  state: "quarantined" | "unreadable" | "orphaned";
  createdAt: string | null;
  updatedAt: string;
  targets: readonly TransactionHealthTarget[];
  diagnostics: readonly string[];
  allowedActions: readonly TransactionRecoveryAction[];
}>;
