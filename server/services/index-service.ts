import { type Dirent } from "node:fs";
import { lstat, opendir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import matter from "gray-matter";
import {
  COMPATIBLE_SCAN_DIRECTORIES,
  VERIFICATION_DIRECTORY
} from "../../shared/vault-map";
import { atomicWriteText } from "../lib/atomic-write";
import { hasErrorCode } from "../lib/error-code";
import { withProcessKeyLock } from "../lib/process-key-lock";
import {
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "../lib/path-safety";
import { readProjectionFile } from "../projections/projection-file";
import { formatFilesystemUtcStamp } from "./vault-service";
import { readDocumentRegistryIfPresent } from "../documents/document-registry";
import {
  documentAwareSourceFingerprint,
  registeredReadingIndexEntry
} from "../documents/global-index-bridge";
import {
  ISO_UTC_MILLISECONDS,
  IndexAssetParseError,
  conceptFor,
  effectiveCardMastery,
  indexDocumentSchema,
  isCardAssetType,
  parseErrorEntry,
  parseNextReview,
  parsePersistedCardMastery,
  requireIndexString as requireString,
  resolveAssetType,
  type AssetType,
  type IndexDocument,
  type IndexEntry,
  type IndexScanOptions,
  type MarkdownCandidate,
  type ParseErrorEntry,
  type RebuildIndexResult
} from "./index-contract";
export type {
  AssetType,
  CardAssetType,
  IndexDocument,
  IndexEntry,
  IndexScanOptions,
  ParseErrorEntry,
  RebuildIndexResult
} from "./index-contract";
export {
  assertIndexFileCount,
  MAX_INDEX_DIRECTORY_DEPTH,
  MAX_INDEX_MARKDOWN_BYTES,
  MAX_INDEX_MARKDOWN_FILES,
  MAX_INDEX_SCAN_DURATION_MS,
  MAX_INDEX_TOTAL_ENTRIES
} from "./index-scan-budget";
import {
  acquireIndexResource,
  assertIndexDepth,
  assertIndexFileCount,
  assertIndexScanActive,
  countIndexEntry,
  createIndexTraversalBudget,
  IndexScanError,
  withinIndexScanBudget,
  type IndexTraversalBudget
} from "./index-scan-budget";

import {
  assertStableDirectory,
  filesystemModifiedAt,
  readMarkdownCandidateBounded
} from "./index-candidate-reader";
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
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
  const createdAt =
    typeof data.createdAt === "string" &&
    ISO_UTC_MILLISECONDS.test(data.createdAt)
      ? data.createdAt
      : null;
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
    createdAt,
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
  const registeredDocuments =
    (await readDocumentRegistryIfPresent(vaultPath))?.documents ?? [];
  const registeredByPath = new Map(
    registeredDocuments.map((document) => [document.relativePath, document])
  );
  const assets: IndexEntry[] = [];
  const parseErrors: ParseErrorEntry[] = [];

  for (const candidate of candidates) {
    assertIndexScanActive(budget);
    try {
      const registered = registeredByPath.get(candidate.relativePath);
      if (registered !== undefined) {
        assets.push(registeredReadingIndexEntry(registered, candidate));
        continue;
      }
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

  const candidatePaths = new Set(candidates.map((candidate) => candidate.relativePath));
  for (const registered of registeredDocuments) {
    if (!candidatePaths.has(registered.relativePath)) {
      assets.push(registeredReadingIndexEntry(registered));
    }
  }

  assertIndexScanActive(budget);
  const index: IndexDocument = {
    generatedAt: new Date().toISOString(),
    sourceFingerprint: documentAwareSourceFingerprint(
      candidates,
      todayUtcDate,
      registeredDocuments
    ),
    assets,
    parseErrors
  };

  indexDocumentSchema.parse(index);

  const finalBudget = createIndexTraversalBudget(options);
  const finalCandidates = await collectMarkdownCandidates(
    vaultPath,
    finalBudget
  );
  const finalRegisteredDocuments =
    (await readDocumentRegistryIfPresent(vaultPath))?.documents ?? [];
  const finalFingerprint = documentAwareSourceFingerprint(
    finalCandidates,
    todayUtcDate,
    finalRegisteredDocuments
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
  const registeredDocuments =
    (await readDocumentRegistryIfPresent(vaultPath))?.documents ?? [];
  const expectedFingerprint = documentAwareSourceFingerprint(
    candidates,
    todayUtcDate,
    registeredDocuments
  );
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
    const lockedRegisteredDocuments =
      (await readDocumentRegistryIfPresent(vaultPath))?.documents ?? [];
    const lockedFingerprint = documentAwareSourceFingerprint(
      lockedCandidates,
      todayUtcDate,
      lockedRegisteredDocuments
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
