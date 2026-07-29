import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { atomicWriteText } from "./atomic-write";
import { readBoundedRegularFile } from "./bounded-regular-file";
import { hasErrorCode } from "./error-code";
import {
  assertRealPathInsideRoot,
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "./path-safety";

export const quarantineCategorySchema = z.enum([
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
  try {
    entries = await readdir(categoryRoot);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  const manifests: QuarantineManifest[] = [];
  for (const entry of entries.sort().slice(-MAX_INVENTORY_RECORDS)) {
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
