import { z } from "zod";
import {
  isFullyQualifiedAbsolutePath,
  normalizeVaultRelativePath
} from "../lib/path-safety";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;

function isCanonicalRelativePath(value: string): boolean {
  try {
    return normalizeVaultRelativePath(value) === value;
  } catch {
    return false;
  }
}

export const vaultTransferFileDigestSchema = z
  .object({
    relativePath: z.string().min(1).refine(isCanonicalRelativePath, {
      message: "relativePath must be one canonical Vault-relative path"
    }),
    sha256: z.string().regex(SHA256),
    size: z.number().int().nonnegative().safe()
  })
  .strict();

const transferFilesSchema = z
  .array(vaultTransferFileDigestSchema)
  .max(100_000)
  .superRefine((files, context) => {
    const seen = new Set<string>();
    for (const [index, file] of files.entries()) {
      if (seen.has(file.relativePath)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "relativePath"],
          message: "duplicate normalized transfer path"
        });
      }
      seen.add(file.relativePath);
    }
  });

export const vaultTransferManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    transactionId: z.string().regex(UUID),
    operation: z.enum(["backup", "migration"]),
    sourceVaultId: z.string().regex(UUID).nullable(),
    sourcePath: z
      .string()
      .refine(isFullyQualifiedAbsolutePath)
      .optional(),
    finalPath: z
      .string()
      .refine(isFullyQualifiedAbsolutePath)
      .optional(),
    startedAt: z.string().datetime({ offset: true }),
    completed: z.boolean(),
    phase: z.enum(["copying", "ready"]).optional(),
    files: transferFilesSchema,
    finalFiles: transferFilesSchema.nullable().optional()
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.sourcePath === undefined ||
      manifest.finalPath === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourcePath"],
        message: "sourcePath and finalPath are required"
      });
    }
    if (
      !manifest.completed &&
      (manifest.phase !== "copying" ||
        (manifest.finalFiles !== null &&
          manifest.finalFiles !== undefined))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phase"],
        message: "an incomplete transfer must be in copying phase"
      });
    }
    if (
      manifest.completed &&
      (manifest.phase !== "ready" ||
        (manifest.operation === "migration" &&
          !Array.isArray(manifest.finalFiles)) ||
        (manifest.operation === "backup" && manifest.finalFiles !== null))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phase"],
        message: "a completed transfer has an invalid phase/files combination"
      });
    }
  });

export type FileDigest = z.infer<typeof vaultTransferFileDigestSchema>;
export type VaultTransferManifest = z.infer<
  typeof vaultTransferManifestSchema
>;

export function parseVaultTransferManifest(
  raw: string
): VaultTransferManifest {
  return vaultTransferManifestSchema.parse(JSON.parse(raw));
}
