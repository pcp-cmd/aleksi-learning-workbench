import { createHash } from "node:crypto";
import { constants, type BigIntStats, type Dirent } from "node:fs";
import { lstat, open, opendir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { CARD_TYPES } from "../../shared/card-types";
import {
  COMPATIBLE_SCAN_DIRECTORIES,
  VERIFICATION_DIRECTORY
} from "../../shared/vault-map";
import { atomicWriteText } from "../lib/atomic-write";
import { hasErrorCode } from "../lib/error-code";
import { withProcessKeyLock } from "../lib/process-key-lock";
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
export const MAX_INDEX_MARKDOWN_FILES = 10_000;
export const MAX_INDEX_MARKDOWN_BYTES = 12 * 1024 * 1024;
export const MAX_INDEX_TOTAL_ENTRIES = 50_000;
export const MAX_INDEX_DIRECTORY_DEPTH = 32;
export const MAX_INDEX_SCAN_DURATION_MS = 15_000;
const INDEX_READ_CHUNK_BYTES = 64 * 1024;

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

type IndexTraversalBudget = {
  signal?: AbortSignal;
  deadlineAt: number;
  entryCount: number;
  markdownCount: number;
  maxEntries: number;
  maxDepth: number;
};

class IndexAssetParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IndexAssetParseError";
    this.code = code;
  }
}

class IndexScanError extends Error {
  readonly code:
    | "INDEX_ENTRY_LIMIT"
    | "INDEX_DEPTH_LIMIT"
    | "INDEX_SCAN_DEADLINE_EXCEEDED"
    | "INDEX_SCAN_ABORTED"
    | "INDEX_SOURCE_CHANGED";
  readonly status: number;

  constructor(
    code: IndexScanError["code"],
    message: string,
    status: number
  ) {
    super(message);
    this.name = "IndexScanError";
    this.code = code;
    this.status = status;
  }
}

function boundedScanLimit(
  requested: number | undefined,
  hardMaximum: number,
  name: string
): number {
  if (requested === undefined) {
    return hardMaximum;
  }
  if (!Number.isSafeInteger(requested) || requested < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return Math.min(requested, hardMaximum);
}

function createIndexTraversalBudget(
  options: IndexScanOptions
): IndexTraversalBudget {
  const hardDeadline = Date.now() + MAX_INDEX_SCAN_DURATION_MS;
  const requestedDeadline = options.deadlineAt ?? hardDeadline;
  if (!Number.isFinite(requestedDeadline)) {
    throw new RangeError("Index scan deadline must be a finite epoch timestamp");
  }

  return {
    signal: options.signal,
    deadlineAt: Math.min(requestedDeadline, hardDeadline),
    entryCount: 0,
    markdownCount: 0,
    maxEntries: boundedScanLimit(
      options.limits?.maxEntries,
      MAX_INDEX_TOTAL_ENTRIES,
      "Index entry limit"
    ),
    maxDepth: boundedScanLimit(
      options.limits?.maxDepth,
      MAX_INDEX_DIRECTORY_DEPTH,
      "Index directory depth limit"
    )
  };
}

function indexScanDeadlineError(): IndexScanError {
  return new IndexScanError(
    "INDEX_SCAN_DEADLINE_EXCEEDED",
    `Index scan exceeded the ${MAX_INDEX_SCAN_DURATION_MS} ms deadline`,
    503
  );
}

function assertIndexScanActive(budget: IndexTraversalBudget): void {
  if (budget.signal?.aborted === true) {
    throw new IndexScanError(
      "INDEX_SCAN_ABORTED",
      "Index scan was cancelled",
      503
    );
  }
  if (Date.now() >= budget.deadlineAt) {
    throw indexScanDeadlineError();
  }
}

async function withinIndexScanBudget<T>(
  budget: IndexTraversalBudget,
  operation: () => Promise<T>
): Promise<T> {
  assertIndexScanActive(budget);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const remaining = Math.max(1, budget.deadlineAt - Date.now());
    const cleanup = () => {
      clearTimeout(timer);
      budget.signal?.removeEventListener("abort", onAbort);
    };
    const resolveOnce = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      rejectOnce(
        new IndexScanError(
          "INDEX_SCAN_ABORTED",
          "Index scan was cancelled",
          503
        )
      );
    };
    const timer = setTimeout(() => {
      rejectOnce(indexScanDeadlineError());
    }, remaining);

    budget.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      void operation().then(resolveOnce, rejectOnce);
    } catch (error) {
      rejectOnce(error);
    }
  });
}

async function acquireIndexResource<T extends { close(): Promise<void> }>(
  budget: IndexTraversalBudget,
  operation: () => Promise<T>
): Promise<T> {
  const resourcePromise = operation();
  try {
    return await withinIndexScanBudget(budget, () => resourcePromise);
  } catch (error) {
    void resourcePromise
      .then((resource) => resource.close())
      .catch(() => undefined);
    throw error;
  }
}

function countIndexEntry(budget: IndexTraversalBudget): void {
  budget.entryCount += 1;
  if (budget.entryCount > budget.maxEntries) {
    throw new IndexScanError(
      "INDEX_ENTRY_LIMIT",
      `Learning library exceeds the ${budget.maxEntries} total filesystem entry limit`,
      422
    );
  }
}

function assertIndexDepth(
  depth: number,
  budget: IndexTraversalBudget,
  relativePath: string
): void {
  if (depth > budget.maxDepth) {
    throw new IndexScanError(
      "INDEX_DEPTH_LIMIT",
      `${relativePath} exceeds the ${budget.maxDepth} directory depth limit`,
      422
    );
  }
}

export function assertIndexFileCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Index file count must be a non-negative safe integer");
  }
  if (count > MAX_INDEX_MARKDOWN_FILES) {
    throw new IndexAssetParseError(
      "INDEX_FILE_COUNT_LIMIT",
      `Learning library exceeds the ${MAX_INDEX_MARKDOWN_FILES} Markdown file count limit`
    );
  }
}

async function readMarkdownCandidateBounded(
  vaultPath: string,
  candidate: MarkdownCandidate,
  budget: IndexTraversalBudget
): Promise<string> {
  const tooLarge = () =>
    new IndexAssetParseError(
      "ASSET_FILE_TOO_LARGE",
      `${candidate.relativePath} exceeds the ${MAX_INDEX_MARKDOWN_BYTES} byte file limit`
    );
  if (candidate.size > BigInt(MAX_INDEX_MARKDOWN_BYTES)) {
    throw tooLarge();
  }

  const noFollowFlag = constants.O_NOFOLLOW ?? 0;
  const handle = await acquireIndexResource(budget, () =>
    open(candidate.absolutePath, constants.O_RDONLY | noFollowFlag)
  );
  try {
    const openedInformation = await withinIndexScanBudget(budget, () =>
      handle.stat({ bigint: true })
    );
    await withinIndexScanBudget(budget, () =>
      assertRealPathInsideRoot(vaultPath, candidate.absolutePath)
    );
    const currentInformation = await withinIndexScanBudget(budget, () =>
      lstat(candidate.absolutePath, { bigint: true })
    );
    if (
      !openedInformation.isFile() ||
      !currentInformation.isFile() ||
      currentInformation.isSymbolicLink() ||
      !sameFileIdentity(openedInformation, currentInformation) ||
      !sameCandidateIdentity(openedInformation, candidate) ||
      openedInformation.size !== candidate.size ||
      openedInformation.mtimeNs !== candidate.modifiedNanoseconds ||
      openedInformation.ctimeNs !== candidate.changedNanoseconds
    ) {
      throw changedCandidate(candidate);
    }
    if (openedInformation.size > BigInt(MAX_INDEX_MARKDOWN_BYTES)) {
      throw tooLarge();
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_INDEX_MARKDOWN_BYTES) {
      const remaining = MAX_INDEX_MARKDOWN_BYTES + 1 - total;
      const chunk = Buffer.allocUnsafe(
        Math.min(INDEX_READ_CHUNK_BYTES, remaining)
      );
      const { bytesRead } = await withinIndexScanBudget(budget, () =>
        handle.read(chunk, 0, chunk.length, null)
      );
      if (bytesRead === 0) {
        break;
      }
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > MAX_INDEX_MARKDOWN_BYTES) {
      throw tooLarge();
    }
    const finalOpenedInformation = await withinIndexScanBudget(budget, () =>
      handle.stat({ bigint: true })
    );
    const finalPathInformation = await withinIndexScanBudget(budget, () =>
      lstat(candidate.absolutePath, { bigint: true })
    );
    if (
      !sameFileIdentity(finalOpenedInformation, finalPathInformation) ||
      finalOpenedInformation.size !== openedInformation.size ||
      finalOpenedInformation.mtimeNs !== openedInformation.mtimeNs ||
      finalOpenedInformation.ctimeNs !== openedInformation.ctimeNs ||
      finalPathInformation.size !== openedInformation.size ||
      finalPathInformation.mtimeNs !== openedInformation.mtimeNs ||
      finalPathInformation.ctimeNs !== openedInformation.ctimeNs
    ) {
      throw changedCandidate(candidate);
    }
    if (BigInt(total) !== openedInformation.size) {
      throw changedCandidate(candidate);
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    await handle.close();
  }
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  if (left.ino === 0n || right.ino === 0n) {
    return false;
  }
  return process.platform === "win32"
    ? left.ino === right.ino
    : left.dev === right.dev && left.ino === right.ino;
}

function sameCandidateIdentity(
  information: BigIntStats,
  candidate: MarkdownCandidate
): boolean {
  if (information.ino === 0n || candidate.inode === 0n) {
    return false;
  }
  return process.platform === "win32"
    ? information.ino === candidate.inode
    : information.dev === candidate.device && information.ino === candidate.inode;
}

function changedCandidate(candidate: MarkdownCandidate): IndexAssetParseError {
  return new IndexAssetParseError(
    "ASSET_FILE_CHANGED",
    `${candidate.relativePath} changed during index validation`
  );
}

function filesystemModifiedAt(information: BigIntStats): string {
  const roundedMilliseconds =
    (information.mtimeNs + 500_000n) / 1_000_000n;
  return new Date(Number(roundedMilliseconds)).toISOString();
}

async function assertStableDirectory(
  vaultPath: string,
  directoryPath: string,
  initialInformation: BigIntStats,
  budget: IndexTraversalBudget,
  relativePath: string
): Promise<void> {
  await withinIndexScanBudget(budget, () =>
    assertRealPathInsideRoot(vaultPath, directoryPath)
  );
  const currentInformation = await withinIndexScanBudget(budget, () =>
    lstat(directoryPath, { bigint: true })
  );
  if (
    !currentInformation.isDirectory() ||
    currentInformation.isSymbolicLink() ||
    !sameFileIdentity(initialInformation, currentInformation) ||
    initialInformation.mtimeNs !== currentInformation.mtimeNs ||
    initialInformation.ctimeNs !== currentInformation.ctimeNs
  ) {
    throw new IndexAssetParseError(
      "INVALID_FILESYSTEM_ENTRY",
      `${relativePath} changed during directory validation`
    );
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

async function recoverCorruptIndexCache(vaultPath: string): Promise<boolean> {
  const cachePath = indexJsonPath(vaultPath);
  if (!(await pathExists(cachePath))) {
    return false;
  }

  const cached = await readProjectionFile(
    vaultPath,
    ".aleksi/index.json",
    indexDocumentSchema
  );
  if (cached !== null) {
    return false;
  }

  try {
    await rename(cachePath, await corruptCachePath(vaultPath));
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      // readProjectionFile already quarantined the invalid cache.
      return true;
    }
    throw error;
  }
}

async function collectMarkdownCandidatesInDirectory(
  vaultPath: string,
  directoryRelativePath: string,
  directoryAssetType: AssetType | null,
  budget: IndexTraversalBudget,
  depth: number
): Promise<MarkdownCandidate[]> {
  const directoryPath = resolveInsideRoot(vaultPath, directoryRelativePath);
  let entries: Dirent[];

  assertIndexDepth(depth, budget, directoryRelativePath);
  assertIndexScanActive(budget);

  try {
    const directoryInformation = await withinIndexScanBudget(budget, () =>
      lstat(directoryPath, { bigint: true })
    );
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
    await assertStableDirectory(
      vaultPath,
      directoryPath,
      directoryInformation,
      budget,
      directoryRelativePath
    );

    const directory = await acquireIndexResource(budget, () =>
      opendir(directoryPath)
    );
    entries = [];
    try {
      await assertStableDirectory(
        vaultPath,
        directoryPath,
        directoryInformation,
        budget,
        directoryRelativePath
      );
      for (;;) {
        const entry = await withinIndexScanBudget(budget, () =>
          directory.read()
        );
        if (entry === null) {
          break;
        }
        countIndexEntry(budget);
        entries.push(entry);
      }
      await assertStableDirectory(
        vaultPath,
        directoryPath,
        directoryInformation,
        budget,
        directoryRelativePath
      );
    } finally {
      await directory.close().catch((error: unknown) => {
        if (!hasErrorCode(error, "ERR_DIR_CLOSED")) {
          throw error;
        }
      });
    }
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
    assertIndexScanActive(budget);
    const relativePath = normalizeVaultRelativePath(
      `${directoryRelativePath}/${entry.name}`
    );
    if (
      relativePath === VERIFICATION_DIRECTORY ||
      relativePath.startsWith(`${VERIFICATION_DIRECTORY}/`)
    ) {
      continue;
    }
    const absolutePath = resolveInsideRoot(vaultPath, relativePath);
    const information = await withinIndexScanBudget(budget, () =>
      lstat(absolutePath, { bigint: true })
    );

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
          directoryAssetType,
          budget,
          depth + 1
        ))
      );
      continue;
    }

    if (information.isFile() && entry.name.endsWith(".md")) {
      budget.markdownCount += 1;
      assertIndexFileCount(budget.markdownCount);
      candidates.push({
        absolutePath,
        relativePath,
        directoryAssetType,
        archived: directoryAssetType === null,
        size: information.size,
        modifiedAt: filesystemModifiedAt(information),
        device: information.dev,
        inode: information.ino,
        modifiedNanoseconds: information.mtimeNs,
        changedNanoseconds: information.ctimeNs
      });
    }
  }

  return candidates;
}

async function collectMarkdownCandidates(
  vaultPath: string,
  budget: IndexTraversalBudget
): Promise<MarkdownCandidate[]> {
  const candidates: MarkdownCandidate[] = [];

  for (const directory of COMPATIBLE_SCAN_DIRECTORIES) {
    candidates.push(
      ...(await collectMarkdownCandidatesInDirectory(
        vaultPath,
        directory.relativePath,
        directory.assetType,
        budget,
        0
      ))
    );
    assertIndexFileCount(candidates.length);
  }

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
    hash.update(String(candidate.device), "utf8");
    hash.update("\0", "utf8");
    hash.update(String(candidate.inode), "utf8");
    hash.update("\0", "utf8");
    hash.update(String(candidate.modifiedNanoseconds), "utf8");
    hash.update("\0", "utf8");
    hash.update(String(candidate.changedNanoseconds), "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

async function parseCandidate(
  vaultPath: string,
  candidate: MarkdownCandidate,
  todayUtcDate: string,
  budget: IndexTraversalBudget
): Promise<IndexEntry | null> {
  let parsed: matter.GrayMatterFile<string>;

  const raw = await readMarkdownCandidateBounded(vaultPath, candidate, budget);
  try {
    parsed = matter(raw);
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

async function rebuildIndexWithinBudget(
  vaultPath: string,
  budget: IndexTraversalBudget,
  options: IndexScanOptions,
  existingCandidates?: MarkdownCandidate[]
): Promise<RebuildIndexResult> {
  assertIndexScanActive(budget);
  const recoveredFromCorruption = await recoverCorruptIndexCache(vaultPath);
  assertIndexScanActive(budget);
  const todayUtcDate = new Date().toISOString().slice(0, 10);
  const candidates =
    existingCandidates ?? await collectMarkdownCandidates(vaultPath, budget);
  const assets: IndexEntry[] = [];
  const parseErrors: ParseErrorEntry[] = [];

  for (const candidate of candidates) {
    assertIndexScanActive(budget);
    try {
      const asset = await parseCandidate(
        vaultPath,
        candidate,
        todayUtcDate,
        budget
      );
      if (asset !== null) {
        assets.push(asset);
      }
    } catch (error) {
      if (error instanceof IndexScanError) {
        throw error;
      }
      parseErrors.push(parseErrorEntry(candidate.relativePath, error));
    }
  }

  assertIndexScanActive(budget);
  const index: IndexDocument = {
    generatedAt: new Date().toISOString(),
    sourceFingerprint: sourceFingerprint(candidates, todayUtcDate),
    assets,
    parseErrors
  };

  indexDocumentSchema.parse(index);

  const finalBudget = createIndexTraversalBudget(options);
  const finalCandidates = await collectMarkdownCandidates(
    vaultPath,
    finalBudget
  );
  const finalFingerprint = sourceFingerprint(
    finalCandidates,
    todayUtcDate
  );
  if (finalFingerprint !== index.sourceFingerprint) {
    throw new IndexScanError(
      "INDEX_SOURCE_CHANGED",
      "Learning library changed while the index was being rebuilt",
      409
    );
  }

  assertIndexScanActive(budget);
  await atomicWriteText(indexJsonPath(vaultPath), canonicalIndexJson(index), {
    root: vaultPath
  });

  return {
    index,
    recoveredFromCorruption
  };
}

function vaultRebuildLockKey(vaultPath: string): string {
  const canonical = resolve(vaultPath).normalize("NFC");
  return `index-rebuild:${
    process.platform === "win32"
      ? canonical.toLocaleLowerCase("en-US")
      : canonical
  }`;
}

export async function rebuildIndex(
  vaultPath: string,
  options: IndexScanOptions = {}
): Promise<RebuildIndexResult> {
  return withProcessKeyLock(
    vaultRebuildLockKey(vaultPath),
    () =>
      rebuildIndexWithinBudget(
        vaultPath,
        createIndexTraversalBudget(options),
        options
      )
  );
}

export async function readCachedIndexProjection(
  vaultPath: string
): Promise<IndexDocument | null> {
  return readProjectionFile(
    vaultPath,
    ".aleksi/index.json",
    indexDocumentSchema
  );
}

export async function readIndexProjection(
  vaultPath: string,
  options: IndexScanOptions = {}
): Promise<IndexDocument> {
  const budget = createIndexTraversalBudget(options);
  const todayUtcDate = new Date().toISOString().slice(0, 10);
  const candidates = await collectMarkdownCandidates(vaultPath, budget);
  const expectedFingerprint = sourceFingerprint(candidates, todayUtcDate);
  const cached = await readProjectionFile(
    vaultPath,
    ".aleksi/index.json",
    indexDocumentSchema
  );

  if (cached !== null && cached.sourceFingerprint === expectedFingerprint) {
    return cached;
  }

  return withProcessKeyLock(vaultRebuildLockKey(vaultPath), async () => {
    const lockedBudget = createIndexTraversalBudget(options);
    const lockedCandidates = await collectMarkdownCandidates(
      vaultPath,
      lockedBudget
    );
    const lockedFingerprint = sourceFingerprint(
      lockedCandidates,
      todayUtcDate
    );
    const currentCache = await readProjectionFile(
      vaultPath,
      ".aleksi/index.json",
      indexDocumentSchema
    );
    if (
      currentCache !== null &&
      currentCache.sourceFingerprint === lockedFingerprint
    ) {
      return currentCache;
    }

    return (
      await rebuildIndexWithinBudget(
        vaultPath,
        lockedBudget,
        options,
        lockedCandidates
      )
    ).index;
  });
}
