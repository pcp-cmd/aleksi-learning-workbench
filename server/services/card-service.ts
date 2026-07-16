import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  rm,
  stat
} from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  ARCHIVE_DIRECTORY,
  CARD_DIRECTORIES
} from "../../shared/vault-map";
import { CARD_LABELS } from "../../shared/card-labels";
import {
  cardRecordSchema,
  cardTypeSchema,
  parseCardUpdateInput
} from "../domain/schemas";
import type {
  CardCreateInput,
  CardRecord,
  CardType,
  CardUpdateInput
} from "../domain/types";
import { atomicWriteText } from "../lib/atomic-write";
import { withCardLock } from "../lib/card-lock";
import { hasErrorCode } from "../lib/error-code";
import { allocateUniqueMarkdownPath } from "../lib/filename";
import {
  assertRealPathInsideRoot,
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "../lib/path-safety";
import {
  parseCardMarkdown,
  serializeCardMarkdown
} from "../lib/markdown-codec";
import {
  activeLearningLibrary,
  learningLibraryRelativePath
} from "../persistence/library-context";
import {
  createSaveReceipt,
  type SaveReceipt
} from "../persistence/save-receipt";
import { rebuildIndex } from "./index-service";
import { getReadingById, ReadingServiceError } from "./reading-service";
import {
  assertInitializedVault
} from "./vault-service";

const indexCacheSchema = z
  .object({
    assets: z.array(
      z
        .object({
          id: z.string().min(1),
          assetType: z.string().min(1),
          relativePath: z.string().min(1),
          updatedAt: z.string().min(1),
          archived: z.boolean()
        })
        .passthrough()
    )
  })
  .passthrough();

const archiveInputSchema = z
  .object({
    confirmed: z.literal(true)
  })
  .strict();

export type { SaveReceipt } from "../persistence/save-receipt";

export type PersistedCard = CardRecord & {
  relativePath: string;
  modifiedAt: string;
};

export type SavedCardResponse = {
  card: PersistedCard;
  saveReceipt: SaveReceipt;
};

export type RecentCard = {
  id: string;
  title: string;
  type: CardType;
  typeLabel: string;
  relativePath: string;
  modifiedAt: string;
  preview: {
    concept: string;
    content: string;
    sourceReading: string;
  };
};

type CardIndexEntry = {
  id: string;
  assetType: CardType;
  relativePath: string;
  updatedAt: string;
  archived: boolean;
};

export class CardServiceError extends Error {
  readonly code:
    | "CARD_ALREADY_ARCHIVED"
    | "CARD_NOT_FOUND"
    | "ARCHIVE_DESTINATION_UNSAFE"
    | "ARCHIVE_TARGET_EXISTS"
    | "CARD_PATH_UNSAFE"
    | "INVALID_ARCHIVE_CONFIRMATION"
    | "INVALID_INDEX_CACHE";
  readonly status: number;

  constructor(
    code:
      | "CARD_ALREADY_ARCHIVED"
      | "CARD_NOT_FOUND"
      | "ARCHIVE_DESTINATION_UNSAFE"
      | "ARCHIVE_TARGET_EXISTS"
      | "CARD_PATH_UNSAFE"
      | "INVALID_ARCHIVE_CONFIRMATION"
      | "INVALID_INDEX_CACHE",
    message: string,
    status = 400
  ) {
    super(message);
    this.name = "CardServiceError";
    this.code = code;
    this.status = status;
  }
}

function invalidIndexCache(): never {
  throw new CardServiceError(
    "INVALID_INDEX_CACHE",
    "Index cache is invalid"
  );
}

function nextUtcDate(createdAt: string): string {
  const date = new Date(createdAt);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveSourceReadingPath(
  sourceReadingId: string
): Promise<string> {
  try {
    return (await getReadingById(sourceReadingId)).relativePath;
  } catch (error) {
    if (error instanceof ReadingServiceError) {
      throw error;
    }
    throw error;
  }
}

function cardResponse(
  card: CardRecord,
  receipt: SaveReceipt
): SavedCardResponse {
  return {
    card: {
      ...card,
      relativePath: receipt.relativePath,
      modifiedAt: receipt.modifiedAt
    },
    saveReceipt: receipt
  };
}

function createRevision(note: string) {
  return {
    at: todayUtcDate(),
    note,
    reviewId: null
  };
}

function createInitialCardRecord(
  input: CardCreateInput,
  sourceReading: string
): CardRecord {
  const createdAt = new Date().toISOString();
  const { sourceReadingId: _sourceReadingId, ...clientFields } = input;

  return cardRecordSchema.parse({
    ...clientFields,
    schemaVersion: 2,
    compatibleMetadata: {},
    id: randomUUID(),
    createdAt,
    nextReview: nextUtcDate(createdAt),
    sourceReading,
    mastery: "learning",
    lastAppliedReviewId: null,
    lastAppliedReviewSequence: null,
    reviewAppliedAt: null,
    reviewOverrideAt: null,
    pendingReviewId: null,
    revisionLog: [
      {
        at: createdAt.slice(0, 10),
        note: "Created card",
        reviewId: null
      }
    ]
  }) as CardRecord;
}

function updateCardRecord(
  existing: CardRecord,
  input: CardUpdateInput,
  sourceReading: string
): CardRecord {
  const { sourceReadingId: _sourceReadingId, ...clientFields } = input;

  return cardRecordSchema.parse({
    ...existing,
    ...clientFields,
    schemaVersion: 2,
    sourceReading,
    revisionLog: [
      ...existing.revisionLog,
      createRevision("Updated card")
    ]
  }) as CardRecord;
}

function archiveCardRecord(existing: CardRecord): CardRecord {
  return cardRecordSchema.parse({
    ...existing,
    mastery: "archived",
    revisionLog: [
      ...existing.revisionLog,
      createRevision("Archived card")
    ]
  }) as CardRecord;
}

async function restoreOriginalMarkdown(
  vaultPath: string,
  absolutePath: string,
  rawMarkdown: string
): Promise<void> {
  await atomicWriteText(absolutePath, rawMarkdown, { root: vaultPath });
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

async function assertArchiveDirectorySafe(
  vaultPath: string,
  archiveParentPath: string
): Promise<void> {
  const archiveRootPath = resolveInsideRoot(vaultPath, ARCHIVE_DIRECTORY);

  try {
    const archiveRootInformation = await lstat(archiveRootPath);
    if (
      !archiveRootInformation.isDirectory() ||
      archiveRootInformation.isSymbolicLink()
    ) {
      throw new CardServiceError(
        "ARCHIVE_DESTINATION_UNSAFE",
        "Archive destination must be a real directory inside the Vault"
      );
    }
    await assertRealPathInsideRoot(vaultPath, archiveRootPath);

    await mkdir(archiveParentPath, { recursive: true });
    const archiveParentInformation = await lstat(archiveParentPath);
    if (
      !archiveParentInformation.isDirectory() ||
      archiveParentInformation.isSymbolicLink()
    ) {
      throw new CardServiceError(
        "ARCHIVE_DESTINATION_UNSAFE",
        "Archive destination must be a real directory inside the Vault"
      );
    }
    await assertRealPathInsideRoot(vaultPath, archiveParentPath);
  } catch (error) {
    if (error instanceof CardServiceError) {
      throw error;
    }
    throw new CardServiceError(
      "ARCHIVE_DESTINATION_UNSAFE",
      "Archive destination must be a real directory inside the Vault"
    );
  }
}

function validateCardRelativePath(entry: CardIndexEntry): string {
  let normalized: string;

  try {
    normalized = normalizeVaultRelativePath(entry.relativePath);
  } catch {
    invalidIndexCache();
  }

  if (normalized !== entry.relativePath || !normalized.endsWith(".md")) {
    invalidIndexCache();
  }

  const activePrefix = `${CARD_DIRECTORIES[entry.assetType]}/`;
  const archivedPrefix = `${ARCHIVE_DIRECTORY}/${activePrefix}`;
  const expectedPrefix = entry.archived ? archivedPrefix : activePrefix;

  if (!normalized.startsWith(expectedPrefix)) {
    invalidIndexCache();
  }

  return normalized;
}

function cardIndexEntryFromAsset(asset: {
  id: string;
  assetType: string;
  relativePath: string;
  updatedAt: string;
  archived: boolean;
}): CardIndexEntry | null {
  const type = cardTypeSchema.safeParse(asset.assetType);
  if (!type.success) {
    return null;
  }

  const entry = {
    id: asset.id,
    assetType: type.data,
    relativePath: asset.relativePath,
    updatedAt: asset.updatedAt,
    archived: asset.archived
  };

  return {
    ...entry,
    relativePath: validateCardRelativePath(entry)
  };
}

async function readCardIndexEntries(
  vaultPath: string
): Promise<CardIndexEntry[]> {
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
    .map(cardIndexEntryFromAsset)
    .filter((entry): entry is CardIndexEntry => entry !== null);
}

async function findCardIndexEntry(
  vaultPath: string,
  id: string
): Promise<CardIndexEntry> {
  const entry = (await readCardIndexEntries(vaultPath)).find(
    (candidate) => candidate.id === id
  );

  if (entry === undefined) {
    throw new CardServiceError(
      "CARD_NOT_FOUND",
      "Card was not found",
      404
    );
  }

  return entry;
}

function previewContent(card: CardRecord): string {
  const record = card as CardRecord & Record<string, unknown>;
  const primaryKeysByType: Record<CardType, string[]> = {
    boundary: ["confusingObjects", "judgementRule"],
    concept: ["myUnderstanding", "formalExplanation"],
    counterexample: ["counterexampleContent", "whyItIsNot"],
    definition: ["formalDefinition", "plainExplanation"],
    example: ["exampleContent", "whyItFits"],
    mistake: ["mistake", "realCause", "correctMethod"],
    process: ["task", "steps"],
    proof: ["proposition", "proofOutline"]
  };

  for (const key of [
    ...primaryKeysByType[card.type],
    "excerpt",
    "understanding",
    "nextAction"
  ]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return card.title;
}

function recentCardFromPersisted(card: PersistedCard): RecentCard {
  return {
    id: card.id,
    title: card.title,
    type: card.type,
    typeLabel: CARD_LABELS[card.type].label,
    relativePath: card.relativePath,
    modifiedAt: card.modifiedAt,
    preview: {
      concept: card.concept,
      content: previewContent(card),
      sourceReading: card.sourceReading
    }
  };
}

async function readCardAtIndexEntry(
  vaultPath: string,
  entry: CardIndexEntry
): Promise<{
  card: CardRecord;
  absolutePath: string;
  modifiedAt: string;
  rawMarkdown: string;
}> {
  const absolutePath = resolveInsideRoot(vaultPath, entry.relativePath);
  let raw: string;
  let modifiedAt: string;

  try {
    const information = await lstat(absolutePath);
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new CardServiceError(
        "CARD_PATH_UNSAFE",
        "Card Markdown path must be a real file inside the Vault"
      );
    }
    await assertRealPathInsideRoot(vaultPath, absolutePath);
    raw = await readFile(absolutePath, "utf8");
    modifiedAt = (await stat(absolutePath)).mtime.toISOString();
  } catch (error) {
    if (error instanceof CardServiceError) {
      throw error;
    }
    if (hasErrorCode(error, "ENOENT", "ENOTDIR")) {
      throw new CardServiceError(
        "CARD_NOT_FOUND",
        "Card Markdown file was not found",
        404
      );
    }
    throw new CardServiceError(
      "CARD_PATH_UNSAFE",
      "Card Markdown path must be a real file inside the Vault"
    );
  }

  let card: CardRecord;
  try {
    card = parseCardMarkdown(raw);
  } catch {
    invalidIndexCache();
  }

  if (card.id !== entry.id || card.type !== entry.assetType) {
    invalidIndexCache();
  }

  return { card, absolutePath, modifiedAt, rawMarkdown: raw };
}

export async function createCard(
  input: CardCreateInput
): Promise<SavedCardResponse> {
  const vaultPath = await activeLearningLibrary();
  const sourceReading = await resolveSourceReadingPath(input.sourceReadingId);
  const directory = resolveInsideRoot(vaultPath, CARD_DIRECTORIES[input.type]);
  const targetPath = await allocateUniqueMarkdownPath(directory, input.title, {
    root: vaultPath
  });
  const relativePath = learningLibraryRelativePath(vaultPath, targetPath);
  const card = createInitialCardRecord(input, sourceReading);

  try {
    const writeReceipt = await atomicWriteText(
      targetPath,
      serializeCardMarkdown(card),
      { root: vaultPath }
    );

    await rebuildIndex(vaultPath);

    return cardResponse(
      card,
      createSaveReceipt(relativePath, writeReceipt.path, writeReceipt.modifiedAt)
    );
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function getCardByIdInVault(
  vaultPath: string,
  id: string
): Promise<PersistedCard> {
  await assertInitializedVault(vaultPath);
  const entry = await findCardIndexEntry(vaultPath, id);
  const parsed = await readCardAtIndexEntry(vaultPath, entry);

  return {
    ...parsed.card,
    relativePath: entry.relativePath,
    modifiedAt: parsed.modifiedAt
  };
}

export async function getCardById(id: string): Promise<PersistedCard> {
  return getCardByIdInVault(await activeLearningLibrary(), id);
}

export async function listRecentCards(limit: number): Promise<RecentCard[]> {
  const vaultPath = await activeLearningLibrary();
  const entries = (await readCardIndexEntries(vaultPath))
    .filter((entry) => !entry.archived)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
  const cards = [];

  for (const entry of entries) {
    const parsed = await readCardAtIndexEntry(vaultPath, entry);
    cards.push(
      recentCardFromPersisted({
        ...parsed.card,
        relativePath: entry.relativePath,
        modifiedAt: parsed.modifiedAt
      })
    );
  }

  return cards;
}

async function updateCardUnlocked(
  id: string,
  body: unknown
): Promise<SavedCardResponse> {
  const vaultPath = await activeLearningLibrary();
  const entry = await findCardIndexEntry(vaultPath, id);
  if (entry.archived) {
    throw new CardServiceError(
      "CARD_ALREADY_ARCHIVED",
      "Archived cards cannot be updated",
      409
    );
  }
  const existing = await readCardAtIndexEntry(vaultPath, entry);
  const input = parseCardUpdateInput(existing.card.type, body);
  const sourceReading = await resolveSourceReadingPath(input.sourceReadingId);
  const updated = updateCardRecord(existing.card, input, sourceReading);
  let writeReceipt;
  let wrote = false;

  try {
    writeReceipt = await atomicWriteText(
      existing.absolutePath,
      serializeCardMarkdown(updated),
      { root: vaultPath }
    );
    wrote = true;

    await rebuildIndex(vaultPath);
  } catch (error) {
    if (wrote) {
      await restoreOriginalMarkdown(
        vaultPath,
        existing.absolutePath,
        existing.rawMarkdown
      ).catch(() => undefined);
    }
    throw error;
  }

  return cardResponse(
    updated,
    createSaveReceipt(entry.relativePath, writeReceipt.path, writeReceipt.modifiedAt)
  );
}

export async function updateCard(
  id: string,
  body: unknown
): Promise<SavedCardResponse> {
  return withCardLock(id, () => updateCardUnlocked(id, body));
}

async function archiveCardUnlocked(
  id: string,
  body: unknown
): Promise<SavedCardResponse> {
  if (!archiveInputSchema.safeParse(body).success) {
    throw new CardServiceError(
      "INVALID_ARCHIVE_CONFIRMATION",
      "Archive requires confirmed: true"
    );
  }

  const vaultPath = await activeLearningLibrary();
  const entry = await findCardIndexEntry(vaultPath, id);
  if (entry.archived) {
    throw new CardServiceError(
      "CARD_ALREADY_ARCHIVED",
      "Card is already archived",
      409
    );
  }

  const existing = await readCardAtIndexEntry(vaultPath, entry);
  const archived = archiveCardRecord(existing.card);
  const archiveRelativePath = normalizeVaultRelativePath(
    `${ARCHIVE_DIRECTORY}/${entry.relativePath}`
  );
  const archiveAbsolutePath = resolveInsideRoot(vaultPath, archiveRelativePath);
  const archiveParentPath = dirname(archiveAbsolutePath);

  await assertArchiveDirectorySafe(vaultPath, archiveParentPath);
  if (await pathExists(archiveAbsolutePath)) {
    throw new CardServiceError(
      "ARCHIVE_TARGET_EXISTS",
      "Archive target already exists",
      409
    );
  }

  let archiveCreated = false;
  let originalRemoved = false;
  try {
    try {
      await link(existing.absolutePath, archiveAbsolutePath);
      archiveCreated = true;
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        throw new CardServiceError(
          "ARCHIVE_TARGET_EXISTS",
          "Archive target already exists",
          409
        );
      }
      throw error;
    }

    const writeReceipt = await atomicWriteText(
      archiveAbsolutePath,
      serializeCardMarkdown(archived),
      { root: vaultPath }
    );
    await rm(existing.absolutePath);
    originalRemoved = true;

    await rebuildIndex(vaultPath);

    return cardResponse(
      archived,
      createSaveReceipt(
        archiveRelativePath,
        writeReceipt.path,
        writeReceipt.modifiedAt
      )
    );
  } catch (error) {
    let restoredOriginal = !originalRemoved;
    if (originalRemoved) {
      try {
        await restoreOriginalMarkdown(
          vaultPath,
          existing.absolutePath,
          existing.rawMarkdown
        );
        restoredOriginal = true;
      } catch {
        restoredOriginal = false;
      }
    }
    if (archiveCreated && restoredOriginal) {
      await rm(archiveAbsolutePath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

export async function archiveCard(
  id: string,
  body: unknown
): Promise<SavedCardResponse> {
  return withCardLock(id, () => archiveCardUnlocked(id, body));
}
