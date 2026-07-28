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
