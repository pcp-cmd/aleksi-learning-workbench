import type {
  DocumentChunkContent,
  DocumentRegistryEntry,
  LearningDocumentDescriptor,
  StoredDocumentIndex
} from "../../shared/document-contract";
import { readIndexProjection } from "../services/index-service";
import type { LibraryOperationContext } from "../persistence/library-context";
import {
  findDocumentRegistryEntry,
  readDocumentRegistry,
  upsertDocumentRegistryEntry
} from "./document-registry";
import {
  documentDescriptor,
  ensureDocumentIndex
} from "./document-index-store";
import { readDocumentSourceRange } from "./document-source";
import { normalizeVaultRelativePath } from "../lib/path-safety";
import { READING_DIRECTORY } from "../../shared/vault-map";

export class DocumentServiceError extends Error {
  constructor(
    readonly code:
      | "DOCUMENT_NOT_FOUND"
      | "DOCUMENT_CHUNK_NOT_FOUND"
      | "DOCUMENT_SOURCE_UNAVAILABLE"
      | "DOCUMENT_QUERY_INVALID",
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "DocumentServiceError";
  }
}

async function legacyDocumentEntry(
  context: LibraryOperationContext,
  documentId: string
): Promise<DocumentRegistryEntry | null> {
  const index = await readIndexProjection(context.path, { signal: context.signal });
  const reading = index.assets.find(
    (entry) => entry.id === documentId && entry.assetType === "reading"
  );
  if (reading === undefined) return null;
  if (reading.concept === null) {
    throw new DocumentServiceError(
      "DOCUMENT_NOT_FOUND",
      "Reading metadata is incomplete",
      404
    );
  }
  return {
    documentId: reading.id,
    readingId: reading.id,
    relativePath: reading.relativePath,
    title: reading.title,
    concept: reading.concept,
    source: "legacy",
    createdAt: reading.createdAt ?? reading.updatedAt
  };
}

export async function resolveDocumentEntry(
  context: LibraryOperationContext,
  documentId: string
): Promise<DocumentRegistryEntry> {
  context.assertCurrent();
  const registered = await findDocumentRegistryEntry(
    context.path,
    context.vaultId,
    documentId
  );
  if (registered !== null) return registered;
  const legacy = await legacyDocumentEntry(context, documentId);
  if (legacy === null) {
    throw new DocumentServiceError(
      "DOCUMENT_NOT_FOUND",
      "Reading document was not found",
      404
    );
  }
  return upsertDocumentRegistryEntry(context, legacy);
}

export async function getStoredDocument(
  context: LibraryOperationContext,
  documentId: string
): Promise<StoredDocumentIndex> {
  const entry = await resolveDocumentEntry(context, documentId);
  try {
    return await ensureDocumentIndex(context, entry);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "SOURCE_MISSING"
    ) {
      throw new DocumentServiceError(
        "DOCUMENT_SOURCE_UNAVAILABLE",
        "The canonical Markdown source is unavailable; relink it to rebuild the document",
        409
      );
    }
    throw error;
  }
}

export async function getDocumentDescriptor(
  context: LibraryOperationContext,
  documentId: string
): Promise<LearningDocumentDescriptor> {
  return documentDescriptor(await getStoredDocument(context, documentId));
}

export async function getDocumentChunk(
  context: LibraryOperationContext,
  documentId: string,
  chunkId: string
): Promise<DocumentChunkContent> {
  const index = await getStoredDocument(context, documentId);
  const chunk = index.chunks.find((candidate) => candidate.chunkId === chunkId);
  if (chunk === undefined) {
    throw new DocumentServiceError(
      "DOCUMENT_CHUNK_NOT_FOUND",
      "Document section was not found; the source may have been reindexed",
      404
    );
  }
  const markdown = await readDocumentSourceRange(
    context.path,
    index.sourcePath,
    chunk.sourceStartOffset,
    chunk.sourceEndOffset
  );
  const renderMarkdown =
    index.definitionMarkdown.length === 0
      ? markdown
      : `${markdown}\n\n${index.definitionMarkdown}`;
  const { plainText: _plainText, ...metadata } = chunk;
  return { ...metadata, markdown: renderMarkdown };
}

export async function relinkDocumentSource(
  context: LibraryOperationContext,
  documentId: string,
  requestedRelativePath: string
): Promise<LearningDocumentDescriptor> {
  const entry = await resolveDocumentEntry(context, documentId);
  const relativePath = normalizeVaultRelativePath(requestedRelativePath);
  if (
    !relativePath.startsWith(`${READING_DIRECTORY}/`) ||
    !/\.(?:md|markdown|txt)$/iu.test(relativePath)
  ) {
    throw new DocumentServiceError(
      "DOCUMENT_QUERY_INVALID",
      `Relink source must be a Markdown or text file inside ${READING_DIRECTORY}`,
      422
    );
  }
  const registry = await readDocumentRegistry(context.path, context.vaultId);
  if (registry.documents.some(
    (candidate) =>
      candidate.documentId !== entry.documentId &&
      candidate.relativePath === relativePath
  )) {
    throw new DocumentServiceError(
      "DOCUMENT_QUERY_INVALID",
      "The selected source is already linked to another reading material",
      409
    );
  }
  const updated = { ...entry, relativePath };
  const index = await ensureDocumentIndex(context, updated);
  await upsertDocumentRegistryEntry(context, updated);
  return documentDescriptor(index);
}
