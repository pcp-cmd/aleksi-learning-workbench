import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  DocumentRegistry,
  DocumentRegistryEntry
} from "../../shared/document-contract";
import { DOCUMENT_REGISTRY_SCHEMA_VERSION } from "../../shared/document-contract";
import { DOCUMENT_REGISTRY_PATH } from "../../shared/vault-map";
import { atomicWriteText } from "../lib/atomic-write";
import { hasErrorCode } from "../lib/error-code";
import { resolveInsideRoot } from "../lib/path-safety";
import type { LibraryOperationContext } from "../persistence/library-context";
import { withProcessKeyLock } from "../lib/process-key-lock";
import { documentRegistrySchema } from "./document-schemas";

function registryPath(vaultPath: string): string {
  return resolveInsideRoot(vaultPath, DOCUMENT_REGISTRY_PATH);
}

function emptyRegistry(vaultId: string): DocumentRegistry {
  return {
    schemaVersion: DOCUMENT_REGISTRY_SCHEMA_VERSION,
    vaultId,
    documents: []
  };
}

export async function readDocumentRegistry(
  vaultPath: string,
  vaultId: string
): Promise<DocumentRegistry> {
  let raw: string;
  try {
    raw = await readFile(registryPath(vaultPath), "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return emptyRegistry(vaultId);
    }
    throw error;
  }
  const parsed = documentRegistrySchema.parse(JSON.parse(raw));
  if (parsed.vaultId !== vaultId) {
    throw new Error("Document registry belongs to a different Local Learning Library");
  }
  return parsed;
}

export async function readDocumentRegistryIfPresent(
  vaultPath: string
): Promise<DocumentRegistry | null> {
  try {
    const raw = await readFile(registryPath(vaultPath), "utf8");
    return documentRegistrySchema.parse(JSON.parse(raw));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

export async function findDocumentRegistryEntry(
  vaultPath: string,
  vaultId: string,
  documentId: string
): Promise<DocumentRegistryEntry | null> {
  return (
    (await readDocumentRegistry(vaultPath, vaultId)).documents.find(
      (entry) => entry.documentId === documentId || entry.readingId === documentId
    ) ?? null
  );
}

export async function upsertDocumentRegistryEntry(
  context: LibraryOperationContext,
  entry: DocumentRegistryEntry
): Promise<DocumentRegistryEntry> {
  const lockRoot = resolve(context.path).normalize("NFC");
  return withProcessKeyLock(`document-registry:${lockRoot}`, async () => {
    context.assertCurrent();
    const registry = await readDocumentRegistry(context.path, context.vaultId);
    const documents = registry.documents.filter(
      (candidate) =>
        candidate.documentId !== entry.documentId &&
        candidate.readingId !== entry.readingId &&
        candidate.relativePath !== entry.relativePath
    );
    documents.push(entry);
    documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    await atomicWriteText(
      registryPath(context.path),
      `${JSON.stringify({ ...registry, documents }, null, 2)}\n`,
      { root: context.path }
    );
    return entry;
  });
}
