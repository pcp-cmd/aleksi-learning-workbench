import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  DocumentRegistryEntry,
  LearningDocumentDescriptor,
  StoredDocumentIndex
} from "../../shared/document-contract";
import {
  DOCUMENT_INDEX_SCHEMA_VERSION,
  DOCUMENT_PARSER_VERSION
} from "../../shared/document-contract";
import { DOCUMENT_INDEX_DIRECTORY } from "../../shared/vault-map";
import { atomicWriteText } from "../lib/atomic-write";
import { hasErrorCode } from "../lib/error-code";
import { resolveInsideRoot } from "../lib/path-safety";
import type { LibraryOperationContext } from "../persistence/library-context";
import { withProcessKeyLock } from "../lib/process-key-lock";
import { segmentMarkdownDocument } from "./document-segmenter";
import { storedDocumentIndexSchema } from "./document-schemas";
import {
  inspectDocumentSourceVersion,
  readDocumentSource,
  type DocumentSourceSnapshot
} from "./document-source";
import {
  parseMarkdownDocument,
  type ParsedMarkdownDocument
} from "./markdown-document-parser";

function indexPath(vaultPath: string, documentId: string): string {
  return resolveInsideRoot(
    vaultPath,
    `${DOCUMENT_INDEX_DIRECTORY}/${documentId}.json`
  );
}

export async function readStoredDocumentIndex(
  vaultPath: string,
  documentId: string
): Promise<StoredDocumentIndex | null> {
  try {
    const raw = await readFile(indexPath(vaultPath, documentId), "utf8");
    return storedDocumentIndexSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    if (error instanceof SyntaxError || error instanceof Error && error.name === "ZodError") {
      return null;
    }
    throw error;
  }
}

export async function buildDocumentIndex(
  context: LibraryOperationContext,
  entry: DocumentRegistryEntry
): Promise<StoredDocumentIndex> {
  context.assertCurrent();
  const snapshot = await readDocumentSource(context.path, entry.relativePath);
  context.signal.throwIfAborted();
  const parsed = parseMarkdownDocument(snapshot.source);
  return buildDocumentIndexFromSnapshot(context, entry, snapshot, parsed);
}

export async function buildDocumentIndexFromSnapshot(
  context: LibraryOperationContext,
  entry: DocumentRegistryEntry,
  snapshot: DocumentSourceSnapshot,
  parsed: ParsedMarkdownDocument
): Promise<StoredDocumentIndex> {
  context.assertCurrent();
  context.signal.throwIfAborted();
  const segmented = segmentMarkdownDocument(entry.documentId, parsed);
  const index: StoredDocumentIndex = {
    schemaVersion: DOCUMENT_INDEX_SCHEMA_VERSION,
    parserVersion: DOCUMENT_PARSER_VERSION,
    documentId: entry.documentId,
    sourcePath: entry.relativePath,
    sourceHash: snapshot.sourceHash,
    sourceVersion: snapshot.version,
    title: entry.title,
    byteSize: snapshot.version.byteSize,
    lineCount: segmented.lineCount,
    outline: segmented.outline,
    chunks: segmented.chunks,
    definitionMarkdown: segmented.definitionMarkdown,
    complexity: segmented.complexity,
    processingStatus: "ready",
    indexedAt: new Date().toISOString(),
    diagnostics: parsed.diagnostics
  };
  storedDocumentIndexSchema.parse(index);
  await atomicWriteText(
    indexPath(context.path, entry.documentId),
    `${JSON.stringify(index)}\n`,
    { root: context.path }
  );
  return index;
}

function sameSourceVersion(
  left: StoredDocumentIndex["sourceVersion"],
  right: StoredDocumentIndex["sourceVersion"]
): boolean {
  return left.byteSize === right.byteSize &&
    left.modifiedNanoseconds === right.modifiedNanoseconds &&
    left.inode === right.inode;
}

export async function ensureDocumentIndex(
  context: LibraryOperationContext,
  entry: DocumentRegistryEntry
): Promise<StoredDocumentIndex> {
  const lockRoot = resolve(context.path).normalize("NFC");
  return withProcessKeyLock(`document-index:${lockRoot}:${entry.documentId}`, async () => {
    const stored = await readStoredDocumentIndex(context.path, entry.documentId);
    if (stored !== null && stored.sourcePath === entry.relativePath) {
      const inspectedVersion = await inspectDocumentSourceVersion(
        context.path,
        entry.relativePath
      );
      if (sameSourceVersion(stored.sourceVersion, inspectedVersion)) {
        return stored;
      }
      const snapshot = await readDocumentSource(context.path, entry.relativePath);
      if (stored.sourceHash === snapshot.sourceHash) {
        const refreshed = { ...stored, sourceVersion: snapshot.version, indexedAt: new Date().toISOString() };
        await atomicWriteText(
          indexPath(context.path, entry.documentId),
          `${JSON.stringify(refreshed)}\n`,
          { root: context.path }
        );
        return refreshed;
      }
    }
    return buildDocumentIndex(context, entry);
  });
}

export function documentDescriptor(index: StoredDocumentIndex): LearningDocumentDescriptor {
  const { definitionMarkdown: _definitions, chunks, ...metadata } = index;
  return {
    ...metadata,
    chunks: chunks.map(({ plainText: _plainText, ...chunk }) => chunk)
  };
}
