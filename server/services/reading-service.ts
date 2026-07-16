import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open, readFile, rm } from "node:fs/promises";
import { extname, posix } from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import {
  linkSafeStringSchema,
  nonEmptyBodyStringSchema
} from "../domain/schemas";
import { atomicWriteText } from "../lib/atomic-write";
import { hasErrorCode } from "../lib/error-code";
import { allocateUniqueMarkdownPath } from "../lib/filename";
import {
  assertRealPathInsideRoot,
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "../lib/path-safety";
import {
  activeLearningLibrary,
  learningLibraryRelativePath
} from "../persistence/library-context";
import { markdownFrontmatterValue } from "../persistence/markdown-value";
import { rebuildIndex } from "./index-service";
import type { IndexEntry } from "./index-service";
import { READING_DIRECTORY } from "../../shared/vault-map";

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

export const ReadingInputSchema = z
  .object({
    title: linkSafeStringSchema,
    concept: linkSafeStringSchema,
    body: nonEmptyBodyStringSchema,
    source: z.enum(["manual-paste", "file-import"]).default("manual-paste"),
    sourceFileName: sourceFileNameSchema.optional(),
    conflictMode: z.enum(["create-new", "replace"]).default("create-new"),
    replaceReadingId: z.string().uuid().optional()
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
    if (value.conflictMode === "create-new" && value.replaceReadingId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replaceReadingId"],
        message: "replaceReadingId is only valid in replace mode"
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

const indexCacheSchema = z
  .object({
    assets: z.array(
      z
        .object({
          id: z.string().min(1),
          assetType: z.string().min(1),
          title: z.string().min(1),
          concept: z.string().nullable(),
          relativePath: z.string().min(1),
          updatedAt: z.string().min(1)
        })
        .passthrough()
    )
  })
  .passthrough();

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
  };
  saveReceipt: {
    relativePath: string;
    modifiedAt: string;
  };
};

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
    | "READING_ASSET_NOT_FOUND"
    | "INVALID_READING_ASSET"
    | "INVALID_INDEX_CACHE"
    | "READING_REPLACE_CONFLICT";
  readonly status: number;

  constructor(
    code:
      | "READING_NOT_FOUND"
      | "READING_ASSET_NOT_FOUND"
      | "INVALID_READING_ASSET"
      | "INVALID_INDEX_CACHE"
      | "READING_REPLACE_CONFLICT",
    message: string,
    status = 400
  ) {
    super(message);
    this.name = "ReadingServiceError";
    this.code = code;
    this.status = status;
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

async function readIndexEntries(vaultPath: string): Promise<ReadingListEntry[]> {
  const indexPath = resolveInsideRoot(vaultPath, ".aleksi/index.json");
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    invalidIndexCache();
  }

  const parsed = indexCacheSchema.safeParse(parsedJson);

  if (!parsed.success) {
    invalidIndexCache();
  }

  return parsed.data.assets
    .map((asset) =>
      readingFromIndexEntry({
        ...asset,
        assetType: asset.assetType as IndexEntry["assetType"],
        mastery: null,
        nextReview: null,
        archived: false
      })
    )
    .filter((entry): entry is ReadingListEntry => entry !== null)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function createReading(
  input: ReadingInput
): Promise<CreatedReading> {
  const vaultPath = await activeLearningLibrary();
  if (input.conflictMode === "replace" && input.replaceReadingId !== undefined) {
    return replaceReading(vaultPath, input, input.replaceReadingId);
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
  try {
    const receipt = await atomicWriteText(targetPath, markdown, {
      root: vaultPath
    });

    await rebuildIndex(vaultPath);

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
        modifiedAt: receipt.modifiedAt
      },
      saveReceipt: {
        relativePath,
        modifiedAt: receipt.modifiedAt
      }
    };
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => undefined);
    throw error;
  }
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
  vaultPath: string,
  input: ReadingInput,
  replaceReadingId: string
): Promise<CreatedReading> {
  const existing = await readingById(vaultPath, replaceReadingId);
  if (normalizedComparableTitle(existing.title) !== normalizedComparableTitle(input.title)) {
    throw new ReadingServiceError(
      "READING_REPLACE_CONFLICT",
      "Replacement title does not match the selected reading",
      409
    );
  }

  const targetPath = resolveInsideRoot(vaultPath, existing.relativePath);
  const original = await readReadingMarkdown(vaultPath, existing.relativePath);
  const createdAt = originalCreatedAt(original, existing.updatedAt);
  const markdown = readingMarkdown({
    id: existing.id,
    title: input.title,
    concept: input.concept,
    body: input.body,
    source: input.source,
    sourceFileName: input.sourceFileName,
    createdAt
  });

  try {
    const receipt = await atomicWriteText(targetPath, markdown, { root: vaultPath });
    await rebuildIndex(vaultPath);
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
        modifiedAt: receipt.modifiedAt
      },
      saveReceipt: {
        relativePath: existing.relativePath,
        modifiedAt: receipt.modifiedAt
      }
    };
  } catch (error) {
    await atomicWriteText(targetPath, original, { root: vaultPath }).catch(() => undefined);
    await rebuildIndex(vaultPath).catch(() => undefined);
    throw error;
  }
}

export async function listReadings(): Promise<ReadingListEntry[]> {
  return readIndexEntries(await activeLearningLibrary());
}

export async function getReadingById(id: string): Promise<ReadingRawEntry> {
  const vaultPath = await activeLearningLibrary();
  const reading = await readingById(vaultPath, id);

  return {
    ...reading,
    rawMarkdown: await readReadingMarkdown(vaultPath, reading.relativePath)
  };
}

export async function getReadingByRelativePathInVault(
  vaultPath: string,
  relativePath: string
): Promise<ReadingRawEntry> {
  const normalizedPath = validatedReadingRelativePath(relativePath);
  const reading = (await readIndexEntries(vaultPath)).find(
    (entry) => entry.relativePath === normalizedPath
  );

  if (reading === undefined) {
    throw new ReadingServiceError(
      "READING_NOT_FOUND",
      "Reading was not found",
      404
    );
  }

  return {
    ...reading,
    rawMarkdown: await readReadingMarkdown(vaultPath, reading.relativePath)
  };
}

async function readingById(
  vaultPath: string,
  id: string
): Promise<ReadingListEntry> {
  const reading = (await readIndexEntries(vaultPath)).find(
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

export async function getReadingAssetById(
  id: string,
  assetReference: string
): Promise<ReadingAsset> {
  const vaultPath = await activeLearningLibrary();
  const reading = await readingById(vaultPath, id);
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
        !sameFileIdentity(openedInformation, currentInformation)
      ) {
        return invalidReadingAsset("Reading image changed during validation");
      }

      if (openedInformation.size > BigInt(READING_IMAGE_MAX_BYTES)) {
        return invalidReadingAsset("Reading image exceeds the 10 MiB size limit");
      }

      const data = Buffer.alloc(Number(openedInformation.size));
      let offset = 0;
      while (offset < data.length) {
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

      return {
        data: offset === data.length ? data : data.subarray(0, offset),
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

async function readReadingMarkdown(
  vaultPath: string,
  relativePath: string
): Promise<string> {
  try {
    return await readFile(resolveInsideRoot(vaultPath, relativePath), "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) {
      throw new ReadingServiceError(
        "READING_NOT_FOUND",
        "Reading Markdown file was not found",
        404
      );
    }
    throw new ReadingServiceError(
      "INVALID_INDEX_CACHE",
      "Reading Markdown file could not be read"
    );
  }
}
