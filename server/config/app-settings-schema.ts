import { createHash } from "node:crypto";
import { z } from "zod";
import { isFullyQualifiedAbsolutePath } from "../lib/path-safety";

const ISO_UTC_MILLISECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

const activeVaultPathSchema = z
  .string()
  .min(1)
  .refine((value) => isFullyQualifiedAbsolutePath(value), {
    message: "activeVaultPath must be a fully qualified absolute path"
  });

export const legacyAppSettingsSchema = z
  .object({
    activeVaultPath: activeVaultPathSchema,
    updatedAt: z.string().regex(ISO_UTC_MILLISECONDS)
  })
  .strict();

const appSettingsFieldsSchema = z
  .object({
    schemaVersion: z.literal(2),
    revision: z.number().int().positive(),
    activeVaultPath: activeVaultPathSchema,
    updatedAt: z.string().regex(ISO_UTC_MILLISECONDS)
  })
  .strict();

export type AppSettingsFields = z.infer<typeof appSettingsFieldsSchema>;

export type AppSettings = Readonly<
  AppSettingsFields & {
    checksum: string;
  }
>;

export function checksumAppSettings(
  fields: AppSettingsFields
): string {
  const canonical = appSettingsFieldsSchema.parse({
    schemaVersion: fields.schemaVersion,
    revision: fields.revision,
    activeVaultPath: fields.activeVaultPath,
    updatedAt: fields.updatedAt
  });
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: canonical.schemaVersion,
        revision: canonical.revision,
        activeVaultPath: canonical.activeVaultPath,
        updatedAt: canonical.updatedAt
      }),
      "utf8"
    )
    .digest("hex");
}

export function createAppSettings(
  fields: AppSettingsFields
): AppSettings {
  const canonical = appSettingsFieldsSchema.parse(fields);
  return Object.freeze({
    ...canonical,
    checksum: checksumAppSettings(canonical)
  });
}

export const appSettingsSchema = appSettingsFieldsSchema
  .extend({ checksum: z.string().regex(SHA256) })
  .strict()
  .superRefine((value, context) => {
    if (value.checksum !== checksumAppSettings(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checksum"],
        message: "checksum does not match the locator fields"
      });
    }
  });
