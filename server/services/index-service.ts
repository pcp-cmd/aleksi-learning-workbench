import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rename } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod";
import { CARD_TYPES } from "../../shared/card-types";
import { COMPATIBLE_SCAN_DIRECTORIES } from "../../shared/vault-map";
import { atomicWriteText } from "../lib/atomic-write";
import { hasErrorCode } from "../lib/error-code";
import {
  assertRealPathInsideRoot,
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "../lib/path-safety";
import { readProjectionFile } from "../projections/projection-file";
import { formatFilesystemUtcStamp } from "./vault-service";

const ISO_UTC_MILLISECONDS =
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
  mastery: "learning" | "due" | "mastered" | "rebuild" | "archived" | null;
  nextReview: string | null;
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
    updatedAt: z.string().regex(ISO_UTC_MILLISECONDS),
    archived: z.boolean()
  })
  .strict();

const indexDocumentSchema = z
  .object({
    generatedAt: z.string().regex(ISO_UTC_MILLISECONDS),
    sourceFingerprint: z.string().regex(SHA256_PATTERN),
    assets: z.array(indexEntrySchema),
    parseErrors: z.array(parseErrorEntrySchema)
  })
  .strict();

type PersistedCardMastery = "learning" | "mastered" | "rebuild" | "archived";

type MarkdownCandidate = {
  absolutePath: string;
  relativePath: string;
  directoryAssetType: AssetType | null;
  archived: boolean;
  size: number;
  modifiedAt: string;
};

class IndexAssetParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IndexAssetParseError";
    this.code = code;
  }
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isCardAssetType(value: AssetType): value is CardAssetType {
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

function requireString(
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

function resolveAssetType(
  data: Record<string, unknown>,
  candidate: MarkdownCandidate
): AssetType {
  const rawType = requireString(data, "type", candidate.relativePath);

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

function parsePersistedCardMastery(
  data: Record<string, unknown>,
  relativePath: string
): PersistedCardMastery {
  const value = requireString(data, "mastery", relativePath);
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

function parseNextReview(
  data: Record<string, unknown>,
  relativePath: string
): string {
  const nextReview = requireString(data, "nextReview", relativePath);
  if (!isCalendarDate(nextReview)) {
    throw new IndexAssetParseError(
      "INVALID_INDEX_FRONTMATTER",
      `${relativePath} frontmatter nextReview must be a valid YYYY-MM-DD date`
    );
  }
  return nextReview;
}

function effectiveCardMastery(options: {
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

function conceptFor(
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
    return requireString(data, "concept", relativePath);
  }

  return optionalString(data, "concept", relativePath);
}

function parseErrorEntry(
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

function indexJsonPath(vaultPath: string): string {
  return resolveInsideRoot(vaultPath, ".aleksi/index.json");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function corruptCachePath(vaultPath: string): Promise<string> {
  const base = resolveInsideRoot(
    vaultPath,
    `.aleksi/index.corrupt-${formatFilesystemUtcStamp(new Date())}.json`
  );

  for (let index = 1; ; index += 1) {
    const candidate = index === 1 ? base : base.replace(/\.json$/u, `-${index}.json`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
}

function validateIndexCache(raw: string): void {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new IndexAssetParseError(
      "INVALID_INDEX_CACHE",
      error instanceof Error
        ? `Index cache is invalid JSON: ${error.message}`
        : "Index cache is invalid JSON"
    );
  }

  const result = indexDocumentSchema.safeParse(parsed);
  if (!result.success) {
    throw new IndexAssetParseError(
      "INVALID_INDEX_CACHE",
      `Index cache schema is invalid: ${result.error.message}`
    );
  }
}

async function recoverCorruptIndexCache(vaultPath: string): Promise<boolean> {
  const cachePath = indexJsonPath(vaultPath);
  let raw: string;

  try {
    raw = await readFile(cachePath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }

  try {
    validateIndexCache(raw);
    return false;
  } catch (error) {
    if (!(error instanceof IndexAssetParseError)) {
      throw error;
    }
    await rename(cachePath, await corruptCachePath(vaultPath));
    return true;
  }
}

async function collectMarkdownCandidatesInDirectory(
  vaultPath: string,
  directoryRelativePath: string,
  directoryAssetType: AssetType | null
): Promise<MarkdownCandidate[]> {
  const directoryPath = resolveInsideRoot(vaultPath, directoryRelativePath);
  let entries;

  try {
    const directoryInformation = await lstat(directoryPath);
    if (directoryInformation.isSymbolicLink()) {
      throw new IndexAssetParseError(
        "INVALID_FILESYSTEM_ENTRY",
        `${directoryRelativePath} must not be a symlink or junction`
      );
    }
    if (!directoryInformation.isDirectory()) {
      throw new IndexAssetParseError(
        "INVALID_FILESYSTEM_ENTRY",
        `${directoryRelativePath} must be a directory`
      );
    }
    await assertRealPathInsideRoot(vaultPath, directoryPath);
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const candidates: MarkdownCandidate[] = [];

  for (const entry of entries.sort((left, right) =>
    compareText(left.name, right.name)
  )) {
    const relativePath = normalizeVaultRelativePath(
      `${directoryRelativePath}/${entry.name}`
    );
    const absolutePath = resolveInsideRoot(vaultPath, relativePath);
    const information = await lstat(absolutePath);

    if (information.isSymbolicLink()) {
      throw new IndexAssetParseError(
        "INVALID_FILESYSTEM_ENTRY",
        `${relativePath} must not be a symlink or junction`
      );
    }

    if (information.isDirectory()) {
      candidates.push(
        ...(await collectMarkdownCandidatesInDirectory(
          vaultPath,
          relativePath,
          directoryAssetType
        ))
      );
      continue;
    }

    if (information.isFile() && entry.name.endsWith(".md")) {
      candidates.push({
        absolutePath,
        relativePath,
        directoryAssetType,
        archived: directoryAssetType === null,
        size: information.size,
        modifiedAt: information.mtime.toISOString()
      });
    }
  }

  return candidates;
}

async function collectMarkdownCandidates(
  vaultPath: string
): Promise<MarkdownCandidate[]> {
  const candidates = (
    await Promise.all(
      COMPATIBLE_SCAN_DIRECTORIES.map((directory) =>
        collectMarkdownCandidatesInDirectory(
          vaultPath,
          directory.relativePath,
          directory.assetType
        )
      )
    )
  ).flat();

  return candidates.sort((left, right) =>
    compareText(left.relativePath, right.relativePath)
  );
}

function sourceFingerprint(
  candidates: MarkdownCandidate[],
  todayUtcDate: string
): string {
  const hash = createHash("sha256");
  hash.update(`aleksi-index-v1\0${todayUtcDate}\0`, "utf8");
  for (const candidate of candidates) {
    hash.update(candidate.relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(String(candidate.size), "utf8");
    hash.update("\0", "utf8");
    hash.update(candidate.modifiedAt, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

async function parseCandidate(
  candidate: MarkdownCandidate,
  todayUtcDate: string
): Promise<IndexEntry | null> {
  let parsed: matter.GrayMatterFile<string>;

  try {
    parsed = matter(await readFile(candidate.absolutePath, "utf8"));
  } catch (error) {
    throw new IndexAssetParseError(
      "FRONTMATTER_PARSE_ERROR",
      error instanceof Error
        ? error.message
        : "Unable to parse Markdown frontmatter"
    );
  }

  const data = parsed.data as Record<string, unknown>;
  const assetType = resolveAssetType(data, candidate);

  if (assetType === "review" && data.commitState !== "committed") {
    return null;
  }

  const id = requireString(data, "id", candidate.relativePath);
  const title = requireString(data, "title", candidate.relativePath);
  const concept = conceptFor(data, assetType, candidate.relativePath);
  const updatedAt = candidate.modifiedAt;
  let mastery: IndexEntry["mastery"] = null;
  let nextReview: string | null = null;

  if (isCardAssetType(assetType)) {
    nextReview = parseNextReview(data, candidate.relativePath);
    mastery = effectiveCardMastery({
      archived: candidate.archived,
      persistedMastery: parsePersistedCardMastery(data, candidate.relativePath),
      nextReview,
      todayUtcDate
    });
  }

  return {
    id,
    assetType,
    title,
    concept,
    relativePath: candidate.relativePath,
    mastery,
    nextReview,
    updatedAt,
    archived: candidate.archived
  };
}

function canonicalIndexJson(index: IndexDocument): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

export async function rebuildIndex(
  vaultPath: string
): Promise<RebuildIndexResult> {
  const recoveredFromCorruption = await recoverCorruptIndexCache(vaultPath);
  const todayUtcDate = new Date().toISOString().slice(0, 10);
  const candidates = await collectMarkdownCandidates(vaultPath);
  const assets: IndexEntry[] = [];
  const parseErrors: ParseErrorEntry[] = [];

  for (const candidate of candidates) {
    try {
      const asset = await parseCandidate(candidate, todayUtcDate);
      if (asset !== null) {
        assets.push(asset);
      }
    } catch (error) {
      parseErrors.push(parseErrorEntry(candidate.relativePath, error));
    }
  }

  const index: IndexDocument = {
    generatedAt: new Date().toISOString(),
    sourceFingerprint: sourceFingerprint(candidates, todayUtcDate),
    assets,
    parseErrors
  };

  indexDocumentSchema.parse(index);

  await atomicWriteText(indexJsonPath(vaultPath), canonicalIndexJson(index), {
    root: vaultPath
  });

  return {
    index,
    recoveredFromCorruption
  };
}

export async function readIndexProjection(
  vaultPath: string
): Promise<IndexDocument> {
  const todayUtcDate = new Date().toISOString().slice(0, 10);
  const candidates = await collectMarkdownCandidates(vaultPath);
  const expectedFingerprint = sourceFingerprint(candidates, todayUtcDate);
  const cached = await readProjectionFile(
    vaultPath,
    ".aleksi/index.json",
    indexDocumentSchema
  );

  if (cached !== null && cached.sourceFingerprint === expectedFingerprint) {
    return cached;
  }

  return (await rebuildIndex(vaultPath)).index;
}
