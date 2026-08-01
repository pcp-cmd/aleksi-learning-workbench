import { z } from "zod";
import { CARD_TYPES } from "../../shared/card-types";

export const ISO_UTC_MILLISECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const ASSET_TYPES = [
  "reading",
  ...CARD_TYPES,
  "diagnosis",
  "review",
  "codex-task"
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];
export type CardAssetType = (typeof CARD_TYPES)[number];

export type IndexEntry = {
  id: string;
  assetType: AssetType;
  title: string;
  concept: string | null;
  relativePath: string;
  mastery:
    | "learning"
    | "due"
    | "mastered"
    | "rebuild"
    | "archived"
    | null;
  nextReview: string | null;
  createdAt?: string | null;
  updatedAt: string;
  archived: boolean;
};

export type ParseErrorEntry = {
  relativePath: string;
  code: string;
  message: string;
};

export type IndexDocument = {
  generatedAt: string;
  sourceFingerprint: string;
  assets: IndexEntry[];
  parseErrors: ParseErrorEntry[];
};

export type RebuildIndexResult = {
  index: IndexDocument;
  recoveredFromCorruption: boolean;
};

const assetTypeSchema = z.enum(ASSET_TYPES);
const masterySchema = z
  .enum(["learning", "due", "mastered", "rebuild", "archived"])
  .nullable();
const parseErrorEntrySchema = z
  .object({
    relativePath: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();
const indexEntrySchema = z
  .object({
    id: z.string().min(1),
    assetType: assetTypeSchema,
    title: z.string().min(1),
    concept: z.string().min(1).nullable(),
    relativePath: z.string().min(1),
    mastery: masterySchema,
    nextReview: z.string().regex(DATE_PATTERN).nullable(),
    createdAt: z
      .string()
      .regex(ISO_UTC_MILLISECONDS)
      .nullable()
      .default(null),
    updatedAt: z.string().regex(ISO_UTC_MILLISECONDS),
    archived: z.boolean()
  })
  .strict();

export const indexDocumentSchema = z
  .object({
    generatedAt: z.string().regex(ISO_UTC_MILLISECONDS),
    sourceFingerprint: z.string().regex(SHA256_PATTERN),
    assets: z.array(indexEntrySchema),
    parseErrors: z.array(parseErrorEntrySchema)
  })
  .strict();

type PersistedCardMastery =
  | "learning"
  | "mastered"
  | "rebuild"
  | "archived";

export type MarkdownCandidate = {
  absolutePath: string;
  relativePath: string;
  directoryAssetType: AssetType | null;
  archived: boolean;
  size: bigint;
  modifiedAt: string;
  device: bigint;
  inode: bigint;
  modifiedNanoseconds: bigint;
  changedNanoseconds: bigint;
};

export type IndexScanOptions = {
  signal?: AbortSignal;
  deadlineAt?: number;
  limits?: {
    maxEntries?: number;
    maxDepth?: number;
  };
};

export class IndexAssetParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IndexAssetParseError";
    this.code = code;
  }
}

export function isCardAssetType(
  value: AssetType
): value is CardAssetType {
  return (CARD_TYPES as readonly string[]).includes(value);
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function requireIndexString(
  data: Record<string, unknown>,
  key: string,
  relativePath: string
): string {
  const value = data[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new IndexAssetParseError(
      "INVALID_INDEX_FRONTMATTER",
      `${relativePath} frontmatter ${key} must be a nonempty string`
    );
  }
  return value;
}

function optionalString(
  data: Record<string, unknown>,
  key: string,
  relativePath: string
): string | null {
  const value = data[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new IndexAssetParseError(
      "INVALID_INDEX_FRONTMATTER",
      `${relativePath} frontmatter ${key} must be a string when present`
    );
  }
  return value;
}

function parseAssetType(
  value: string,
  relativePath: string
): AssetType {
  const parsed = assetTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new IndexAssetParseError(
      "INVALID_ARCHIVED_ASSET_TYPE",
      `${relativePath} has unsupported asset type ${JSON.stringify(value)}`
    );
  }
  return parsed.data;
}

export function resolveAssetType(
  data: Record<string, unknown>,
  candidate: MarkdownCandidate
): AssetType {
  const rawType = requireIndexString(
    data,
    "type",
    candidate.relativePath
  );
  if (candidate.directoryAssetType === null) {
    return parseAssetType(rawType, candidate.relativePath);
  }
  if (rawType !== candidate.directoryAssetType) {
    throw new IndexAssetParseError(
      "INVALID_INDEX_FRONTMATTER",
      `${candidate.relativePath} frontmatter type ${JSON.stringify(
        rawType
      )} does not match its asset directory ${JSON.stringify(
        candidate.directoryAssetType
      )}`
    );
  }
  return candidate.directoryAssetType;
}

export function parsePersistedCardMastery(
  data: Record<string, unknown>,
  relativePath: string
): PersistedCardMastery {
  const value = requireIndexString(data, "mastery", relativePath);
  if (
    value !== "learning" &&
    value !== "mastered" &&
    value !== "rebuild" &&
    value !== "archived"
  ) {
    throw new IndexAssetParseError(
      "INVALID_INDEX_FRONTMATTER",
      `${relativePath} frontmatter mastery must be learning, mastered, rebuild, or archived`
    );
  }
  return value;
}

export function parseNextReview(
  data: Record<string, unknown>,
  relativePath: string
): string {
  const nextReview = requireIndexString(data, "nextReview", relativePath);
  if (!isCalendarDate(nextReview)) {
    throw new IndexAssetParseError(
      "INVALID_INDEX_FRONTMATTER",
      `${relativePath} frontmatter nextReview must be a valid YYYY-MM-DD date`
    );
  }
  return nextReview;
}

export function effectiveCardMastery(options: {
  archived: boolean;
  persistedMastery: PersistedCardMastery;
  nextReview: string;
  todayUtcDate: string;
}): IndexEntry["mastery"] {
  if (options.archived) {
    return "archived";
  }
  if (options.persistedMastery === "archived") {
    throw new IndexAssetParseError(
      "INVALID_INDEX_FRONTMATTER",
      "Non-archived card Markdown must not persist archived mastery"
    );
  }
  if (options.persistedMastery === "rebuild") {
    return "rebuild";
  }
  if (options.nextReview <= options.todayUtcDate) {
    return "due";
  }
  return options.persistedMastery;
}

export function conceptFor(
  data: Record<string, unknown>,
  assetType: AssetType,
  relativePath: string
): string | null {
  if (
    assetType === "reading" ||
    assetType === "diagnosis" ||
    assetType === "review" ||
    assetType === "codex-task" ||
    isCardAssetType(assetType)
  ) {
    return requireIndexString(data, "concept", relativePath);
  }
  return optionalString(data, "concept", relativePath);
}

export function parseErrorEntry(
  relativePath: string,
  error: unknown
): ParseErrorEntry {
  if (error instanceof IndexAssetParseError) {
    return {
      relativePath,
      code: error.code,
      message: error.message
    };
  }
  return {
    relativePath,
    code: "ASSET_READ_ERROR",
    message: error instanceof Error ? error.message : "Unable to read asset"
  };
}
