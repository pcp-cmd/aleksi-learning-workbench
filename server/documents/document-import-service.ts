import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink
} from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  DOCUMENT_IMPORT_SCHEMA_VERSION,
  type DocumentImportSession,
  type DocumentRegistryEntry
} from "../../shared/document-contract";
import {
  DOCUMENT_IMPORT_PART_BYTES,
  DOCUMENT_MAX_SOURCE_BYTES
} from "../../shared/document-limits";
import {
  DOCUMENT_IMPORT_DIRECTORY,
  READING_DIRECTORY
} from "../../shared/vault-map";
import { linkSafeStringSchema } from "../domain/schemas";
import { assetVersionSchema, assetVersionsEqual } from "../lib/asset-version";
import { atomicWriteText } from "../lib/atomic-write";
import { sanitizeWindowsFilename } from "../lib/filename";
import { hasErrorCode } from "../lib/error-code";
import { resolveInsideRoot } from "../lib/path-safety";
import { withProcessKeyLock } from "../lib/process-key-lock";
import type { LibraryOperationContext } from "../persistence/library-context";
import { refreshIndexProjection } from "../projections/projection-runner";
import {
  buildDocumentIndex,
  buildDocumentIndexFromSnapshot
} from "./document-index-store";
import { getStoredDocument, resolveDocumentEntry } from "./document-service";
import { upsertDocumentRegistryEntry } from "./document-registry";
import { documentImportSessionSchema } from "./document-schemas";
import { readDocumentSource } from "./document-source";
import { parseMarkdownDocument } from "./markdown-document-parser";

const supportedFileNameSchema = z.string().trim().min(1).max(255).refine(
  (value) => /\.(?:md|markdown|txt)$/iu.test(value),
  "fileName must be .md, .markdown, or .txt"
);

export const createDocumentImportSchema = z.object({
  fileName: supportedFileNameSchema,
  expectedBytes: z.number().int().positive().max(DOCUMENT_MAX_SOURCE_BYTES),
  title: linkSafeStringSchema,
  concept: linkSafeStringSchema,
  conflictMode: z.enum(["create-new", "replace"]).default("create-new"),
  replaceReadingId: z.string().uuid().optional(),
  expectedVersion: assetVersionSchema.optional()
}).strict().superRefine((value, context) => {
  if (value.conflictMode === "replace" && value.replaceReadingId === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["replaceReadingId"],
      message: "Replacing a reading requires replaceReadingId"
    });
  }
  if (value.conflictMode === "replace" && value.expectedVersion === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expectedVersion"],
      message: "Replacing a reading requires expectedVersion"
    });
  }
  if (
    value.conflictMode === "create-new" &&
    (value.replaceReadingId !== undefined || value.expectedVersion !== undefined)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["conflictMode"],
      message: "Replacement fields are only valid in replace mode"
    });
  }
});

export class DocumentImportError extends Error {
  constructor(
    readonly code:
      | "IMPORT_SESSION_NOT_FOUND"
      | "IMPORT_OFFSET_CONFLICT"
      | "IMPORT_SOURCE_MISMATCH"
      | "IMPORT_INCOMPLETE"
      | "IMPORT_PART_TOO_LARGE"
      | "IMPORT_REPLACE_CONFLICT",
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DocumentImportError";
  }
}

function sessionRelativePath(sessionId: string): string {
  return `${DOCUMENT_IMPORT_DIRECTORY}/${sessionId}.json`;
}

function partRelativePath(sessionId: string): string {
  return `${DOCUMENT_IMPORT_DIRECTORY}/${sessionId}.part`;
}

function sessionPath(vaultPath: string, sessionId: string): string {
  return resolveInsideRoot(vaultPath, sessionRelativePath(sessionId));
}

function partPath(vaultPath: string, sessionId: string): string {
  return resolveInsideRoot(vaultPath, partRelativePath(sessionId));
}

async function writeSession(
  context: LibraryOperationContext,
  session: DocumentImportSession
): Promise<void> {
  documentImportSessionSchema.parse(session);
  await atomicWriteText(
    sessionPath(context.path, session.sessionId),
    `${JSON.stringify(session, null, 2)}\n`,
    { root: context.path }
  );
}

export async function readDocumentImportSession(
  context: LibraryOperationContext,
  sessionId: string
): Promise<DocumentImportSession> {
  let raw: string;
  try {
    raw = await readFile(sessionPath(context.path, sessionId), "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new DocumentImportError(
        "IMPORT_SESSION_NOT_FOUND",
        "Document import session was not found",
        404
      );
    }
    throw error;
  }
  const session = documentImportSessionSchema.parse(JSON.parse(raw));
  if (session.vaultId !== context.vaultId) {
    throw new DocumentImportError(
      "IMPORT_SESSION_NOT_FOUND",
      "Document import session belongs to another Local Learning Library",
      404
    );
  }
  if (session.status === "uploading" || session.status === "failed") {
    const part = await lstat(partPath(context.path, sessionId));
    const receivedBytes = Number(part.size);
    if (receivedBytes !== session.receivedBytes) {
      return { ...session, receivedBytes };
    }
  }
  return session;
}

export async function createDocumentImportSession(
  context: LibraryOperationContext,
  input: z.infer<typeof createDocumentImportSchema>
): Promise<DocumentImportSession> {
  const sessionId = randomUUID();
  const directory = resolveInsideRoot(context.path, DOCUMENT_IMPORT_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const handle = await open(partPath(context.path, sessionId), "wx");
  await handle.close();
  const now = new Date().toISOString();
  const session: DocumentImportSession = {
    schemaVersion: DOCUMENT_IMPORT_SCHEMA_VERSION,
    sessionId,
    vaultId: context.vaultId,
    fileName: input.fileName.normalize("NFC"),
    expectedBytes: input.expectedBytes,
    receivedBytes: 0,
    title: input.title.normalize("NFC"),
    concept: input.concept.normalize("NFC"),
    conflictMode: input.conflictMode,
    replaceReadingId: input.replaceReadingId,
    expectedVersion: input.expectedVersion,
    status: "uploading",
    stage: "reading-material",
    createdAt: now,
    updatedAt: now
  };
  try {
    await writeSession(context, session);
    return session;
  } catch (error) {
    await unlink(partPath(context.path, sessionId)).catch(() => undefined);
    throw error;
  }
}

export async function appendDocumentImportPart(
  context: LibraryOperationContext,
  sessionId: string,
  offset: number,
  bytes: Buffer
): Promise<DocumentImportSession> {
  if (bytes.length === 0 || bytes.length > DOCUMENT_IMPORT_PART_BYTES) {
    throw new DocumentImportError(
      "IMPORT_PART_TOO_LARGE",
      `Each document import part must contain 1 to ${DOCUMENT_IMPORT_PART_BYTES} bytes`,
      413
    );
  }
  const lockRoot = resolve(context.path).normalize("NFC");
  return withProcessKeyLock(`document-import:${lockRoot}:${sessionId}`, async () => {
    const session = await readDocumentImportSession(context, sessionId);
    if (session.status !== "uploading" && session.status !== "failed") {
      throw new DocumentImportError(
        "IMPORT_OFFSET_CONFLICT",
        "Document import is no longer accepting data",
        409,
        { receivedBytes: session.receivedBytes }
      );
    }
    if (offset !== session.receivedBytes) {
      throw new DocumentImportError(
        "IMPORT_OFFSET_CONFLICT",
        "Document import offset does not match the durable staged file",
        409,
        { receivedBytes: session.receivedBytes }
      );
    }
    if (offset + bytes.length > session.expectedBytes) {
      throw new DocumentImportError(
        "IMPORT_PART_TOO_LARGE",
        "Document import part exceeds the declared source size",
        413
      );
    }
    const handle = await open(partPath(context.path, sessionId), "r+");
    try {
      await handle.write(bytes, 0, bytes.length, offset);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const updated: DocumentImportSession = {
      ...session,
      receivedBytes: offset + bytes.length,
      status: "uploading",
      error: undefined,
      updatedAt: new Date().toISOString()
    };
    await writeSession(context, updated);
    return updated;
  });
}

export async function verifyDocumentImportPart(
  context: LibraryOperationContext,
  sessionId: string,
  offset: number,
  bytes: Buffer
): Promise<DocumentImportSession> {
  if (bytes.length === 0 || bytes.length > DOCUMENT_IMPORT_PART_BYTES) {
    throw new DocumentImportError(
      "IMPORT_PART_TOO_LARGE",
      `Each document import verification part must contain 1 to ${DOCUMENT_IMPORT_PART_BYTES} bytes`,
      413
    );
  }
  const lockRoot = resolve(context.path).normalize("NFC");
  return withProcessKeyLock(`document-import:${lockRoot}:${sessionId}`, async () => {
    const session = await readDocumentImportSession(context, sessionId);
    if (session.status === "ready") return session;
    if (offset + bytes.length > session.receivedBytes) {
      throw new DocumentImportError(
        "IMPORT_OFFSET_CONFLICT",
        "Document import verification exceeds the durable staged prefix",
        409,
        { receivedBytes: session.receivedBytes }
      );
    }
    const staged = Buffer.allocUnsafe(bytes.length);
    const handle = await open(partPath(context.path, sessionId), "r");
    try {
      const { bytesRead } = await handle.read(staged, 0, bytes.length, offset);
      if (bytesRead !== bytes.length || !staged.equals(bytes)) {
        throw new DocumentImportError(
          "IMPORT_SOURCE_MISMATCH",
          "The selected file does not match the original file for this resumable import",
          409
        );
      }
    } finally {
      await handle.close();
    }
    return session;
  });
}

async function linkCanonicalSource(
  context: LibraryOperationContext,
  session: DocumentImportSession
): Promise<DocumentImportSession> {
  const lockRoot = resolve(context.path).normalize("NFC");
  return withProcessKeyLock(`document-import-target:${lockRoot}`, async () => {
    const directory = resolveInsideRoot(context.path, READING_DIRECTORY);
    await mkdir(directory, { recursive: true });
    let current = session;
    if (current.relativePath !== undefined) {
      const target = resolveInsideRoot(context.path, current.relativePath);
      if (!(await pathExists(target))) {
        await link(partPath(context.path, current.sessionId), target);
        return current;
      }
      const [installed, staged] = await Promise.all([
        readDocumentSource(context.path, current.relativePath),
        readDocumentSource(context.path, partRelativePath(current.sessionId))
      ]);
      if (installed.sourceHash === staged.sourceHash) return current;
      current = {
        ...current,
        relativePath: undefined,
        updatedAt: new Date().toISOString()
      };
      await writeSession(context, current);
    }

    const baseName = sanitizeWindowsFilename(current.title);
    for (let ordinal = 1; ; ordinal += 1) {
      const suffix = ordinal === 1 ? "" : `-${ordinal}`;
      const relativePath = `${READING_DIRECTORY}/${baseName}${suffix}.md`;
      const target = resolveInsideRoot(context.path, relativePath);
      if (await pathExists(target)) continue;
      const reserved: DocumentImportSession = {
        ...current,
        relativePath,
        updatedAt: new Date().toISOString()
      };
      await writeSession(context, reserved);
      try {
        await link(partPath(context.path, current.sessionId), target);
        return reserved;
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
        current = {
          ...reserved,
          relativePath: undefined,
          updatedAt: new Date().toISOString()
        };
        await writeSession(context, current);
      }
    }
  });
}

function comparableTitle(value: string): string {
  return value.trim().normalize("NFC").toLocaleLowerCase("zh-CN");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) return false;
    throw error;
  }
}

type InstalledSource = {
  entry: DocumentRegistryEntry;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
};

async function installNewSource(
  context: LibraryOperationContext,
  session: DocumentImportSession,
  documentId: string,
  relativePath: string
): Promise<InstalledSource> {
  const target = resolveInsideRoot(context.path, relativePath);
  return {
    entry: {
      documentId,
      readingId: documentId,
      relativePath,
      title: session.title,
      concept: session.concept,
      source: "file-import",
      sourceFileName: session.fileName,
      createdAt: session.createdAt
    },
    commit: async () => undefined,
    rollback: async () => {
      await unlink(target).catch(() => undefined);
    }
  };
}

async function installReplacementSource(
  context: LibraryOperationContext,
  session: DocumentImportSession
): Promise<InstalledSource> {
  if (session.replaceReadingId === undefined || session.expectedVersion === undefined) {
    throw new DocumentImportError(
      "IMPORT_REPLACE_CONFLICT",
      "Replacement context is incomplete; choose the original material again",
      409
    );
  }
  const existing = await resolveDocumentEntry(context, session.replaceReadingId);
  if (comparableTitle(existing.title) !== comparableTitle(session.title)) {
    throw new DocumentImportError(
      "IMPORT_REPLACE_CONFLICT",
      "Replacement title does not match the selected reading",
      409
    );
  }
  const target = resolveInsideRoot(context.path, existing.relativePath);
  const incoming = resolveInsideRoot(
    context.path,
    `${DOCUMENT_IMPORT_DIRECTORY}/${session.sessionId}.incoming`
  );
  const backup = resolveInsideRoot(
    context.path,
    `${DOCUMENT_IMPORT_DIRECTORY}/${session.sessionId}.backup`
  );
  const recoveredInstall = (): InstalledSource => ({
    entry: {
      ...existing,
      title: session.title,
      concept: session.concept,
      source: "file-import",
      sourceFileName: session.fileName
    },
    commit: async () => {
      await unlink(backup);
    },
    rollback: async () => {
      await unlink(target).catch(() => undefined);
      await rename(backup, target);
    }
  });
  if (await pathExists(backup)) {
    if (await pathExists(target)) {
      const [installedSnapshot, stagedSnapshot] = await Promise.all([
        readDocumentSource(context.path, existing.relativePath),
        readDocumentSource(context.path, partRelativePath(session.sessionId))
      ]);
      if (installedSnapshot.sourceHash === stagedSnapshot.sourceHash) {
        return recoveredInstall();
      } else {
        await unlink(target);
        await rename(backup, target);
      }
    } else if (await pathExists(incoming)) {
      await rename(incoming, target);
      return recoveredInstall();
    } else {
      await link(partPath(context.path, session.sessionId), target);
      return recoveredInstall();
    }
  }
  const current = await getStoredDocument(context, existing.documentId);
  const currentVersion = {
    sha256: current.sourceHash,
    size: current.sourceVersion.byteSize,
    mtimeNs: current.sourceVersion.modifiedNanoseconds,
    inode: current.sourceVersion.inode
  };
  if (!assetVersionsEqual(currentVersion, session.expectedVersion)) {
    throw new DocumentImportError(
      "IMPORT_REPLACE_CONFLICT",
      "The original material changed after it was opened; reopen it before replacing",
      409
    );
  }

  await unlink(incoming).catch(() => undefined);
  await link(partPath(context.path, session.sessionId), incoming);
  await rename(target, backup);
  try {
    await rename(incoming, target);
  } catch (error) {
    await rename(backup, target).catch(() => undefined);
    await unlink(incoming).catch(() => undefined);
    throw error;
  }

  const replacementEntry: DocumentRegistryEntry = {
    ...existing,
    title: session.title,
    concept: session.concept,
    source: "file-import",
    sourceFileName: session.fileName
  };
  return {
    entry: replacementEntry,
    commit: async () => {
      await unlink(backup);
    },
    rollback: async () => {
      if (await pathExists(backup)) {
        await unlink(target).catch(() => undefined);
        await rename(backup, target);
      }
      await unlink(incoming).catch(() => undefined);
      await upsertDocumentRegistryEntry(context, existing).catch(() => undefined);
      await buildDocumentIndex(context, existing).catch(() => undefined);
    }
  };
}

type ImportedReadingResponse = {
  id: string;
  documentId: string;
  type: "reading";
  title: string;
  concept: string;
  source: "file-import";
  sourceFileName: string;
  createdAt: string;
  relativePath: string;
  modifiedAt: string;
};

function importedReadingResponse(
  entry: DocumentRegistryEntry,
  modifiedAt: string
): ImportedReadingResponse {
  return {
    id: entry.readingId,
    documentId: entry.documentId,
    type: "reading",
    title: entry.title,
    concept: entry.concept,
    source: "file-import",
    sourceFileName: entry.sourceFileName ?? entry.title,
    createdAt: entry.createdAt,
    relativePath: entry.relativePath,
    modifiedAt
  };
}

export async function finalizeDocumentImport(
  context: LibraryOperationContext,
  sessionId: string
): Promise<{
  session: DocumentImportSession;
  reading: ImportedReadingResponse;
  saveReceipt: { relativePath: string; modifiedAt: string };
  projectionStatus: "fresh" | "stale";
  projectionErrorId: string | null;
}> {
  const lockRoot = resolve(context.path).normalize("NFC");
  return withProcessKeyLock(`document-import:${lockRoot}:${sessionId}`, async () => {
    let session = await readDocumentImportSession(context, sessionId);
    if (session.status === "ready" && session.documentId !== undefined && session.relativePath !== undefined) {
      const entry: DocumentRegistryEntry = {
        documentId: session.documentId,
        readingId: session.documentId,
        relativePath: session.relativePath,
        title: session.title,
        concept: session.concept,
        source: "file-import",
        sourceFileName: session.fileName,
        createdAt: session.createdAt
      };
      await unlink(resolveInsideRoot(
        context.path,
        `${DOCUMENT_IMPORT_DIRECTORY}/${session.sessionId}.backup`
      )).catch(() => undefined);
      return {
        session,
        reading: importedReadingResponse(entry, session.updatedAt),
        saveReceipt: { relativePath: session.relativePath, modifiedAt: session.updatedAt },
        projectionStatus: "fresh",
        projectionErrorId: null
      };
    }
    if (session.receivedBytes !== session.expectedBytes) {
      throw new DocumentImportError(
        "IMPORT_INCOMPLETE",
        "Document upload is incomplete and can be resumed",
        409,
        { receivedBytes: session.receivedBytes, expectedBytes: session.expectedBytes }
      );
    }
    const documentId = session.documentId ?? randomUUID();
    session = {
      ...session,
      documentId,
      status: "processing",
      stage: "analyzing-structure",
      error: undefined,
      updatedAt: new Date().toISOString()
    };
    await writeSession(context, session);
    let installed: InstalledSource | null = null;
    try {
      const stagedSnapshot = await readDocumentSource(
        context.path,
        partRelativePath(sessionId)
      );
      const parsed = parseMarkdownDocument(stagedSnapshot.source);
      if (session.conflictMode === "replace") {
        installed = await installReplacementSource(context, session);
      } else {
        session = await linkCanonicalSource(context, session);
        if (session.relativePath === undefined) {
          throw new Error("Canonical source reservation did not produce a target path");
        }
        installed = await installNewSource(
          context,
          session,
          documentId,
          session.relativePath
        );
      }
      const entry = installed.entry;
      const relativePath = entry.relativePath;
      session = {
        ...session,
        documentId: entry.documentId,
        relativePath,
        stage: "preparing-sections",
        updatedAt: new Date().toISOString()
      };
      await writeSession(context, session);
      await buildDocumentIndexFromSnapshot(
        context,
        entry,
        stagedSnapshot,
        parsed
      );
      session = {
        ...session,
        stage: "building-search-index",
        updatedAt: new Date().toISOString()
      };
      await writeSession(context, session);
      await upsertDocumentRegistryEntry(context, entry);
      const projection = await refreshIndexProjection(context.path, context.signal);
      const finalInformation = await lstat(
        resolveInsideRoot(context.path, relativePath)
      );
      session = {
        ...session,
        status: "ready",
        stage: "ready",
        error: undefined,
        updatedAt: new Date().toISOString()
      };
      await writeSession(context, session);
      await installed.commit().catch(() => undefined);
      await unlink(partPath(context.path, sessionId)).catch(() => undefined);
      return {
        session,
        reading: importedReadingResponse(
          entry,
          finalInformation.mtime.toISOString()
        ),
        saveReceipt: {
          relativePath,
          modifiedAt: finalInformation.mtime.toISOString()
        },
        ...projection
      };
    } catch (error) {
      if (installed !== null && session.status !== "ready") {
        await installed.rollback().catch(() => undefined);
      }
      const failed: DocumentImportSession = {
        ...session,
        status: "failed",
        error: error instanceof Error ? error.message : "Document processing failed",
        updatedAt: new Date().toISOString()
      };
      await writeSession(context, failed).catch(() => undefined);
      throw error;
    }
  });
}
