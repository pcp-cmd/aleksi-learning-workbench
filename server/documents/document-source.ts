import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { TextDecoder } from "node:util";
import {
  DOCUMENT_CHUNK_RESPONSE_MAX_BYTES,
  DOCUMENT_MAX_SOURCE_BYTES
} from "../../shared/document-limits";
import type { DocumentSourceVersion } from "../../shared/document-contract";
import { BoundedRegularFileError, readBoundedRegularFile } from "../lib/bounded-regular-file";
import { assertRealPathInsideRoot, resolveInsideRoot } from "../lib/path-safety";

export class DocumentSourceError extends Error {
  readonly status: number;

  constructor(
    readonly code: "SOURCE_MISSING" | "SOURCE_TOO_LARGE" | "SOURCE_ENCODING" | "SOURCE_CHANGED",
    message: string
  ) {
    super(message);
    this.name = "DocumentSourceError";
    this.status = code === "SOURCE_TOO_LARGE"
      ? 413
      : code === "SOURCE_ENCODING"
        ? 422
        : 409;
  }
}

export type DocumentSourceSnapshot = {
  source: string;
  sourceHash: string;
  version: DocumentSourceVersion;
};

function sourceVersion(version: {
  size: bigint;
  modifiedNanoseconds: bigint;
  inode: bigint;
}): DocumentSourceVersion {
  return {
    byteSize: Number(version.size),
    modifiedNanoseconds: version.modifiedNanoseconds.toString(),
    inode: version.inode.toString()
  };
}

export async function inspectDocumentSourceVersion(
  vaultPath: string,
  relativePath: string
): Promise<DocumentSourceVersion> {
  const absolutePath = resolveInsideRoot(vaultPath, relativePath);
  try {
    await assertRealPathInsideRoot(vaultPath, absolutePath);
    const information = await lstat(absolutePath, { bigint: true });
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new DocumentSourceError("SOURCE_CHANGED", "Markdown source must be a regular file");
    }
    if (information.size > BigInt(DOCUMENT_MAX_SOURCE_BYTES)) {
      throw new DocumentSourceError(
        "SOURCE_TOO_LARGE",
        `Markdown source exceeds the ${DOCUMENT_MAX_SOURCE_BYTES} byte safety ceiling`
      );
    }
    return sourceVersion({
      size: information.size,
      modifiedNanoseconds: information.mtimeNs,
      inode: information.ino
    });
  } catch (error) {
    if (error instanceof DocumentSourceError) throw error;
    if (typeof error === "object" && error !== null && "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new DocumentSourceError("SOURCE_MISSING", "Markdown source is unavailable");
    }
    throw error;
  }
}

export async function readDocumentSource(
  vaultPath: string,
  relativePath: string
): Promise<DocumentSourceSnapshot> {
  try {
    const file = await readBoundedRegularFile(
      vaultPath,
      resolveInsideRoot(vaultPath, relativePath),
      { maxBytes: DOCUMENT_MAX_SOURCE_BYTES, label: "Markdown document" }
    );
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(file.data);
    } catch {
      throw new DocumentSourceError(
        "SOURCE_ENCODING",
        "Markdown source is not valid UTF-8; convert the file and retry"
      );
    }
    if (source.includes("\u0000")) {
      throw new DocumentSourceError(
        "SOURCE_ENCODING",
        "Markdown source contains unsupported NUL characters"
      );
    }
    return {
      source,
      sourceHash: file.version.sha256,
      version: sourceVersion(file.version)
    };
  } catch (error) {
    if (error instanceof DocumentSourceError) throw error;
    if (error instanceof BoundedRegularFileError) {
      throw new DocumentSourceError(
        error.code === "FILE_TOO_LARGE" ? "SOURCE_TOO_LARGE" : "SOURCE_CHANGED",
        error.code === "FILE_TOO_LARGE"
          ? `Markdown source exceeds the ${DOCUMENT_MAX_SOURCE_BYTES} byte safety ceiling`
          : "Markdown source changed while it was being read"
      );
    }
    if (typeof error === "object" && error !== null && "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new DocumentSourceError("SOURCE_MISSING", "Markdown source is unavailable");
    }
    throw error;
  }
}

export async function readDocumentSourceRange(
  vaultPath: string,
  relativePath: string,
  startOffset: number,
  endOffset: number
): Promise<string> {
  if (
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    endOffset - startOffset > DOCUMENT_CHUNK_RESPONSE_MAX_BYTES
  ) {
    throw new DocumentSourceError("SOURCE_TOO_LARGE", "Requested document section is not safely bounded");
  }
  const absolutePath = resolveInsideRoot(vaultPath, relativePath);
  await assertRealPathInsideRoot(vaultPath, absolutePath);
  const initial = await lstat(absolutePath, { bigint: true });
  if (!initial.isFile() || initial.isSymbolicLink() || BigInt(endOffset) > initial.size) {
    throw new DocumentSourceError("SOURCE_CHANGED", "Document section no longer matches the source");
  }
  const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const bytes = Buffer.alloc(endOffset - startOffset);
    let readOffset = 0;
    while (readOffset < bytes.length) {
      const result = await handle.read(
        bytes,
        readOffset,
        bytes.length - readOffset,
        startOffset + readOffset
      );
      if (result.bytesRead === 0) break;
      readOffset += result.bytesRead;
    }
    const final = await handle.stat({ bigint: true });
    if (
      readOffset !== bytes.length ||
      final.size !== initial.size ||
      final.mtimeNs !== initial.mtimeNs ||
      final.ino !== initial.ino
    ) {
      throw new DocumentSourceError("SOURCE_CHANGED", "Markdown source changed during section loading");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new DocumentSourceError("SOURCE_ENCODING", "Document section is not valid UTF-8");
    }
  } finally {
    await handle.close();
  }
}
