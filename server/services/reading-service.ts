import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { extname, posix, resolve } from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import {
  linkSafeStringSchema,
  nonEmptyBodyStringSchema
} from "../domain/schemas";
import {
  assetVersionSchema,
  readAssetVersion,
  readVersionedText,
  type AssetVersion
} from "../lib/asset-version";
import {
  BoundedRegularFileError,
  type RegularFileVersion,
  readBoundedRegularFile
} from "../lib/bounded-regular-file";
import { hasErrorCode } from "../lib/error-code";
import { allocateUniqueMarkdownPath } from "../lib/filename";
import {
  assertRealPathInsideRoot,
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "../lib/path-safety";
import { withProcessKeyLock } from "../lib/process-key-lock";
import {
  learningLibraryRelativePath,
  type LibraryOperationContext
} from "../persistence/library-context";
import { markdownFrontmatterValue } from "../persistence/markdown-value";
import type { ProjectionOutcome } from "../projections/projection-types";
import { refreshIndexProjection } from "../projections/projection-runner";
import { runFileTransaction } from "../transactions/transaction-runner";
import {
  readCachedIndexProjection,
  readIndexProjection
} from "./index-service";
import type { IndexEntry } from "./index-service";
import { READING_DIRECTORY } from "../../shared/vault-map";
import {
  READING_BODY_JSON_LIMIT_BYTES,
  READING_DETAIL_JSON_LIMIT_BYTES
} from "../../shared/api-limits";
import type { HttpErrorRecovery } from "../http/error-response";

const sourceFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .transform((value) => value.normalize("NFC"))
  .refine(
    (value) => /^[^/\\\u0000-\u001f\u007f]+\.(?:md|markdown|txt)$/iu.test(value),
    "sourceFileName must be a supported local text file name"
  );

const boundedReadingBodySchema = nonEmptyBodyStringSchema.refine(
  (value) =>
    Buffer.byteLength(JSON.stringify(value), "utf8") <=
    READING_BODY_JSON_LIMIT_BYTES,
  {
    message:
      "Reading body is too large to save and reopen safely; reduce the material size"
  }
);

export const ReadingInputSchema = z
  .object({
    title: linkSafeStringSchema,
    concept: linkSafeStringSchema,
    body: boundedReadingBodySchema,
    source: z.enum(["manual-paste", "file-import"]).default("manual-paste"),
    sourceFileName: sourceFileNameSchema.optional(),
    conflictMode: z.enum(["create-new", "replace"]).default("create-new"),
    replaceReadingId: z.string().uuid().optional(),
    expectedVersion: assetVersionSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
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
    if (value.conflictMode === "create-new" && value.replaceReadingId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replaceReadingId"],
        message: "replaceReadingId is only valid in replace mode"
      });
    }
    if (value.conflictMode === "create-new" && value.expectedVersion !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedVersion"],
        message: "expectedVersion is only valid in replace mode"
      });
    }
    if (value.source === "manual-paste" && value.sourceFileName !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceFileName"],
        message: "sourceFileName is only valid for file imports"
      });
    }
  });

export type ReadingInput = z.infer<typeof ReadingInputSchema>;

export type CreatedReading = {
  reading: {
    id: string;
    type: "reading";
    title: string;
    concept: string;
    source: "manual-paste" | "file-import";
    sourceFileName?: string;
    createdAt: string;
    relativePath: string;
    modifiedAt: string;
    version: AssetVersion;
  };
  saveReceipt: {
    relativePath: string;
    modifiedAt: string;
  };
} & ProjectionOutcome;

export type ReadingListEntry = {
  id: string;
  type: "reading";
  title: string;
  concept: string;
  relativePath: string;
  updatedAt: string;
};

export type ReadingRawEntry = ReadingListEntry & {
  rawMarkdown: string;
  version: AssetVersion;
};

export type ReadingAsset = {
  data: Buffer;
  mimeType: string;
};

const READING_IMAGE_MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);
const READING_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export class ReadingServiceError extends Error {
  readonly code:
    | "READING_NOT_FOUND"
    | "READING_TOO_LARGE"
    | "READING_RESPONSE_TOO_LARGE"
    | "READING_ASSET_NOT_FOUND"
    | "INVALID_READING_ASSET"
    | "INVALID_INDEX_CACHE"
    | "READING_REPLACE_CONFLICT";
  readonly status: number;
  readonly recovery?: HttpErrorRecovery;

  constructor(
    code:
      | "READING_NOT_FOUND"
      | "READING_TOO_LARGE"
      | "READING_RESPONSE_TOO_LARGE"
      | "READING_ASSET_NOT_FOUND"
      | "INVALID_READING_ASSET"
      | "INVALID_INDEX_CACHE"
      | "READING_REPLACE_CONFLICT",
    message: string,
    status = 400,
    recovery?: HttpErrorRecovery
  ) {
    super(message);
    this.name = "ReadingServiceError";
    this.code = code;
    this.status = status;
    this.recovery = recovery;
  }
}

function invalidIndexCache(): never {
  throw new ReadingServiceError(
    "INVALID_INDEX_CACHE",
    "Index cache is invalid"
  );
}

function readingMarkdown(options: {
  id: string;
  title: string;
  concept: string;
  source: "manual-paste" | "file-import";
  sourceFileName?: string;
  createdAt: string;
  body: string;
}): string {
  const body = options.body.endsWith("\n")
    ? options.body
    : `${options.body}\n`;

  return [
    "---",
    `id: ${markdownFrontmatterValue(options.id.normalize("NFC"))}`,
    `type: ${markdownFrontmatterValue("reading")}`,
    `title: ${markdownFrontmatterValue(options.title.normalize("NFC"))}`,
    `concept: ${markdownFrontmatterValue(options.concept.normalize("NFC"))}`,
    `source: ${markdownFrontmatterValue(options.source)}`,
    ...(options.sourceFileName === undefined
      ? []
      : [`sourceFileName: ${markdownFrontmatterValue(options.sourceFileName.normalize("NFC"))}`]),
    `createdAt: ${markdownFrontmatterValue(options.createdAt.normalize("NFC"))}`,
    "---",
    "",
    `# ${options.title}`,
    "",
    body
  ].join("\n");
}

function readingFromIndexEntry(entry: IndexEntry): ReadingListEntry | null {
  if (entry.assetType !== "reading") {
    return null;
  }
  if (entry.concept === null) {
    invalidIndexCache();
  }
  if (!z.string().uuid().safeParse(entry.id).success) {
    invalidIndexCache();
  }

  const relativePath = validatedReadingRelativePath(entry.relativePath);

  return {
    id: entry.id,
    type: "reading",
    title: entry.title,
    concept: entry.concept,
    relativePath,
    updatedAt: entry.updatedAt
  };
}

function validatedReadingRelativePath(relativePath: string): string {
  let normalized: string;

  try {
    normalized = normalizeVaultRelativePath(relativePath);
  } catch {
    invalidIndexCache();
  }

  if (
    normalized !== relativePath ||
    !normalized.startsWith(`${READING_DIRECTORY}/`) ||
    !normalized.endsWith(".md")
  ) {
    invalidIndexCache();
  }

  return normalized;
}

async function readIndexEntries(
  context: LibraryOperationContext
): Promise<ReadingListEntry[]> {
  context.assertCurrent();
  const index = await readIndexProjection(context.path, {
    signal: context.signal
  });
  return index.assets
    .map((asset) =>
      readingFromIndexEntry(asset)
    )
    .filter((entry): entry is ReadingListEntry => entry !== null)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function createReadingInVault(
  context: LibraryOperationContext,
  input: ReadingInput
): Promise<CreatedReading> {
  const vaultPath = context.path;
  context.assertCurrent();
  if (input.conflictMode === "replace" && input.replaceReadingId !== undefined) {
    return replaceReading(context, input, input.replaceReadingId);
  }
  const directory = resolveInsideRoot(vaultPath, READING_DIRECTORY);
  const targetPath = await allocateUniqueMarkdownPath(directory, input.title, {
    root: vaultPath
  });
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const relativePath = learningLibraryRelativePath(vaultPath, targetPath);
  const markdown = readingMarkdown({
    id,
    title: input.title,
    concept: input.concept,
    body: input.body,
    source: input.source,
    sourceFileName: input.sourceFileName,
    createdAt
  });
  const reservedVersion = await readAssetVersion(targetPath);
  await runFileTransaction({
    vaultPath,
    vaultId: context.vaultId,
    operation: "reading-create",
    assertCurrent: context.assertCurrent,
    targets: [{ relativePath, content: markdown, expectedVersion: reservedVersion }]
  });
  const saved = await readVersionedText(targetPath);
  const projection = await refreshIndexProjection(vaultPath, context.signal);

  return {
      reading: {
        id,
        type: "reading",
        title: input.title,
        concept: input.concept,
        source: input.source,
        ...(input.sourceFileName === undefined
          ? {}
          : { sourceFileName: input.sourceFileName }),
        createdAt,
        relativePath,
        modifiedAt: saved.modifiedAt,
        version: saved.version
      },
      saveReceipt: {
        relativePath,
        modifiedAt: saved.modifiedAt
      },
      ...projection
    };
}

function normalizedComparableTitle(value: string): string {
  return value.trim().normalize("NFC").toLocaleLowerCase("zh-CN");
}

function originalCreatedAt(rawMarkdown: string, fallback: string): string {
  const parsed = matter(rawMarkdown).data.createdAt;
  return typeof parsed === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(parsed)
    ? parsed
    : fallback;
}

async function replaceReading(
  context: LibraryOperationContext,
  input: ReadingInput,
  replaceReadingId: string
): Promise<CreatedReading> {
  const vaultPath = context.path;
  const canonicalVaultPath = resolve(vaultPath).normalize("NFC");
  const lockVaultPath =
    process.platform === "win32"
      ? canonicalVaultPath.toLocaleLowerCase("en-US")
      : canonicalVaultPath;

  return withProcessKeyLock(
    `reading-replace:${lockVaultPath}:${replaceReadingId}`,
    () => replaceReadingLocked(context, input, replaceReadingId)
  );
}

async function replaceReadingLocked(
  context: LibraryOperationContext,
  input: ReadingInput,
  replaceReadingId: string
): Promise<CreatedReading> {
  const vaultPath = context.path;
  const existing = await readingById(context, replaceReadingId);
  if (normalizedComparableTitle(existing.title) !== normalizedComparableTitle(input.title)) {
    throw new ReadingServiceError(
      "READING_REPLACE_CONFLICT",
      "Replacement title does not match the selected reading",
      409
    );
  }

  const targetPath = resolveInsideRoot(vaultPath, existing.relativePath);
  const original = await readIndexedReadingMarkdownSnapshot(
    vaultPath,
    existing
  );
  const createdAt = originalCreatedAt(
    original.rawMarkdown,
    existing.updatedAt
  );
  const markdown = readingMarkdown({
    id: existing.id,
    title: input.title,
    concept: input.concept,
    body: input.body,
    source: input.source,
    sourceFileName: input.sourceFileName,
    createdAt
  });
  if (input.expectedVersion === undefined) {
    throw new ReadingServiceError(
      "READING_REPLACE_CONFLICT",
      "Replacement requires the version that was opened",
      409
    );
  }
  await runFileTransaction({
    vaultPath,
    vaultId: context.vaultId,
    operation: "reading-replace",
    assertCurrent: context.assertCurrent,
    targets: [{
      relativePath: existing.relativePath,
      content: markdown,
      expectedVersion: input.expectedVersion
    }]
  });
  const saved = await readVersionedText(targetPath);
  const projection = await refreshIndexProjection(vaultPath, context.signal);
  return {
      reading: {
        id: existing.id,
        type: "reading",
        title: input.title,
        concept: input.concept,
        source: input.source,
        ...(input.sourceFileName === undefined
          ? {}
          : { sourceFileName: input.sourceFileName }),
        createdAt,
        relativePath: existing.relativePath,
        modifiedAt: saved.modifiedAt,
        version: saved.version
      },
      saveReceipt: {
        relativePath: existing.relativePath,
        modifiedAt: saved.modifiedAt
      },
      ...projection
  };
}

export async function listReadingsInVault(
  context: LibraryOperationContext
): Promise<ReadingListEntry[]> {
  return readIndexEntries(context);
}

export async function getReadingByIdInVault(
  context: LibraryOperationContext,
  id: string
): Promise<ReadingRawEntry> {
  const vaultPath = context.path;
  context.assertCurrent();
  const cached = await readCachedIndexProjection(vaultPath);
  const cachedAsset = cached?.assets.find((entry) => entry.id === id);
  const cachedReading =
    cachedAsset === undefined ? null : readingFromIndexEntry(cachedAsset);
  let reading: ReadingListEntry;
  try {
    reading = await readingById(context, id);
  } catch (error) {
    if (
      cachedReading === null ||
      !(error instanceof ReadingServiceError) ||
      error.code !== "READING_NOT_FOUND"
    ) {
      throw error;
    }
    // A fresh projection intentionally drops malformed assets. Retain only the
    // previously verified path long enough for the bounded reader to return a
    // precise recovery error (for example 413 for an oversized legacy file).
    reading = cachedReading;
  }

  const snapshot = await readIndexedReadingMarkdownSnapshot(vaultPath, reading);
  return {
    ...reading,
    rawMarkdown: snapshot.rawMarkdown,
    version: assetVersionFromRegular(snapshot.version)
  };
}

export async function getReadingByRelativePathInVault(
  context: LibraryOperationContext,
  relativePath: string
): Promise<ReadingRawEntry> {
  const vaultPath = context.path;
  const normalizedPath = validatedReadingRelativePath(relativePath);
  const reading = (await readIndexEntries(context)).find(
    (entry) => entry.relativePath === normalizedPath
  );

  if (reading === undefined) {
    throw new ReadingServiceError(
      "READING_NOT_FOUND",
      "Reading was not found",
      404
    );
  }

  const snapshot = await readIndexedReadingMarkdownSnapshot(vaultPath, reading);
  return {
    ...reading,
    rawMarkdown: snapshot.rawMarkdown,
    version: assetVersionFromRegular(snapshot.version)
  };
}

async function readingById(
  context: LibraryOperationContext,
  id: string
): Promise<ReadingListEntry> {
  const reading = (await readIndexEntries(context)).find(
    (entry) => entry.id === id
  );

  if (reading === undefined) {
    throw new ReadingServiceError(
      "READING_NOT_FOUND",
      "Reading was not found",
      404
    );
  }

  return reading;
}

function assertReadingMarkdownMatchesIndex(
  rawMarkdown: string,
  reading: ReadingListEntry
): void {
  let data: Record<string, unknown>;
  try {
    data = matter(rawMarkdown).data as Record<string, unknown>;
  } catch {
    return invalidIndexCache();
  }
  if (
    data.id !== reading.id ||
    data.type !== "reading" ||
    data.title !== reading.title ||
    data.concept !== reading.concept
  ) {
    return invalidIndexCache();
  }
}

type ReadingMarkdownSnapshot = {
  rawMarkdown: string;
  version: RegularFileVersion;
};

function assetVersionFromRegular(version: RegularFileVersion): AssetVersion {
  return {
    sha256: version.sha256,
    size: Number(version.size),
    mtimeNs: version.modifiedNanoseconds.toString(),
    inode: version.inode.toString()
  };
}

async function readIndexedReadingMarkdownSnapshot(
  vaultPath: string,
  reading: ReadingListEntry
): Promise<ReadingMarkdownSnapshot> {
  const snapshot = await readReadingMarkdownSnapshot(
    vaultPath,
    reading.relativePath
  );
  assertReadingMarkdownMatchesIndex(snapshot.rawMarkdown, reading);
  return snapshot;
}

function invalidReadingAsset(message: string): never {
  throw new ReadingServiceError("INVALID_READING_ASSET", message);
}

function resolveReadingAssetReference(
  readingRelativePath: string,
  assetReference: string
): { mimeType: string; relativePath: string } {
  const trimmedReference = assetReference.trim();
  const referenceWithoutSuffix = trimmedReference.split(/[?#]/u, 1)[0] ?? "";

  if (/%(?:2f|5c)/iu.test(referenceWithoutSuffix)) {
    return invalidReadingAsset("Reading image path must not encode path separators");
  }

  let decodedReference: string;
  try {
    decodedReference = decodeURIComponent(referenceWithoutSuffix);
  } catch {
    return invalidReadingAsset("Reading image path uses invalid percent encoding");
  }

  const normalizedReference = decodedReference.normalize("NFC");

  if (
    normalizedReference.length === 0 ||
    /[\u0000-\u001f\u007f]/u.test(normalizedReference) ||
    normalizedReference.includes("\\") ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/iu.test(normalizedReference)
  ) {
    return invalidReadingAsset("Reading image path must be a safe relative path");
  }

  const candidate = posix.normalize(
    posix.join(posix.dirname(readingRelativePath), normalizedReference)
  );
  let relativePath: string;

  try {
    relativePath = normalizeVaultRelativePath(candidate);
  } catch {
    return invalidReadingAsset("Reading image path leaves the learning library");
  }

  const mimeType = READING_IMAGE_MIME_TYPES.get(
    extname(relativePath).toLowerCase()
  );
  if (mimeType === undefined) {
    return invalidReadingAsset("Reading assets must use a supported image type");
  }

  return { mimeType, relativePath };
}

function sameFileIdentity(opened: BigIntStats, currentPath: BigIntStats): boolean {
  if (opened.ino === 0n || currentPath.ino === 0n) {
    return false;
  }

  return process.platform === "win32"
    ? opened.ino === currentPath.ino
    : opened.dev === currentPath.dev && opened.ino === currentPath.ino;
}

export async function getReadingAssetByIdInVault(
  context: LibraryOperationContext,
  id: string,
  assetReference: string
): Promise<ReadingAsset> {
  const vaultPath = context.path;
  context.assertCurrent();
  const reading = await readingById(context, id);
  const asset = resolveReadingAssetReference(
    reading.relativePath,
    assetReference
  );
  const absolutePath = resolveInsideRoot(vaultPath, asset.relativePath);

  try {
    await assertRealPathInsideRoot(vaultPath, absolutePath);
    const initialInformation = await lstat(absolutePath, { bigint: true });
    if (!initialInformation.isFile() || initialInformation.isSymbolicLink()) {
      return invalidReadingAsset("Reading image must be a regular file");
    }

    const noFollowFlag = constants.O_NOFOLLOW ?? 0;
    const file = await open(absolutePath, constants.O_RDONLY | noFollowFlag);
    try {
      const openedInformation = await file.stat({ bigint: true });
      await assertRealPathInsideRoot(vaultPath, absolutePath);
      const currentInformation = await lstat(absolutePath, { bigint: true });

      if (
        !openedInformation.isFile() ||
        !currentInformation.isFile() ||
        currentInformation.isSymbolicLink() ||
        !sameFileIdentity(openedInformation, currentInformation) ||
        currentInformation.size !== openedInformation.size ||
        currentInformation.mtimeNs !== openedInformation.mtimeNs ||
        currentInformation.ctimeNs !== openedInformation.ctimeNs
      ) {
        return invalidReadingAsset("Reading image changed during validation");
      }

      if (openedInformation.size > BigInt(READING_IMAGE_MAX_BYTES)) {
        return invalidReadingAsset("Reading image exceeds the 10 MiB size limit");
      }

      const data = Buffer.alloc(Number(openedInformation.size));
      let offset = 0;
      while (offset < data.length) {
        context.signal.throwIfAborted();
        context.assertCurrent();
        const { bytesRead } = await file.read(
          data,
          offset,
          data.length - offset,
          offset
        );
        if (bytesRead === 0) {
          break;
        }
        offset += bytesRead;
      }
      const finalOpenedInformation = await file.stat({ bigint: true });
      const finalPathInformation = await lstat(absolutePath, {
        bigint: true
      });
      if (
        offset !== data.length ||
        !sameFileIdentity(finalOpenedInformation, finalPathInformation) ||
        finalOpenedInformation.size !== openedInformation.size ||
        finalOpenedInformation.mtimeNs !== openedInformation.mtimeNs ||
        finalOpenedInformation.ctimeNs !== openedInformation.ctimeNs ||
        finalPathInformation.size !== openedInformation.size ||
        finalPathInformation.mtimeNs !== openedInformation.mtimeNs ||
        finalPathInformation.ctimeNs !== openedInformation.ctimeNs
      ) {
        return invalidReadingAsset(
          "Reading image changed while it was being read"
        );
      }

      return {
        data,
        mimeType: asset.mimeType
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof ReadingServiceError) {
      throw error;
    }
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) {
      throw new ReadingServiceError(
        "READING_ASSET_NOT_FOUND",
        "Reading image was not found",
        404
      );
    }
    throw error;
  }
}

async function readReadingMarkdownSnapshot(
  vaultPath: string,
  relativePath: string
): Promise<ReadingMarkdownSnapshot> {
  const tooLarge = () =>
    new ReadingServiceError(
      "READING_TOO_LARGE",
      "Reading Markdown is too large to reopen safely",
      413,
      {
        action: "reduce_payload",
        target: "reading_material",
        maxBytes: READING_BODY_JSON_LIMIT_BYTES
      }
    );

  try {
    const path = resolveInsideRoot(vaultPath, relativePath);
    const file = await readBoundedRegularFile(vaultPath, path, {
      maxBytes: READING_DETAIL_JSON_LIMIT_BYTES,
      label: "Reading Markdown"
    });
    return {
      rawMarkdown: file.data.toString("utf8"),
      version: file.version
    };
  } catch (error) {
    if (error instanceof ReadingServiceError) {
      throw error;
    }
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) {
      throw new ReadingServiceError(
        "READING_NOT_FOUND",
        "Reading Markdown file was not found",
        404
      );
    }
    if (error instanceof BoundedRegularFileError) {
      if (error.code === "FILE_TOO_LARGE") {
        throw tooLarge();
      }
      throw new ReadingServiceError(
        "INVALID_INDEX_CACHE",
        "Reading Markdown changed while it was being read"
      );
    }
    throw new ReadingServiceError(
      "INVALID_INDEX_CACHE",
      "Reading Markdown file could not be read"
    );
  }
}
