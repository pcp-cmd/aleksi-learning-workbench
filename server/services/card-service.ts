import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  realpath
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
import {
  assetVersionSchema,
  assertAssetVersion,
  readAssetVersion,
  readVersionedText,
  type AssetVersion
} from "../lib/asset-version";
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
  learningLibraryRelativePath,
  type LibraryOperationContext
} from "../persistence/library-context";
import {
  createSaveReceipt,
  type SaveReceipt
} from "../persistence/save-receipt";
import type { ProjectionOutcome } from "../projections/projection-types";
import { refreshIndexProjection } from "../projections/projection-runner";
import { runFileTransaction } from "../transactions/transaction-runner";
import {
  getReadingByIdInVault,
  ReadingServiceError
} from "./reading-service";
import {
  readCachedIndexProjection,
  readIndexProjection
} from "./index-service";
import {
  assertInitializedVault
} from "./vault-service";

const archiveInputSchema = z
  .object({
    confirmed: z.literal(true),
    expectedVersion: assetVersionSchema
  })
  .strict();

const cardUpdateEnvelopeSchema = z
  .object({
    expectedVersion: assetVersionSchema
  })
  .passthrough();

export type { SaveReceipt } from "../persistence/save-receipt";

export type PersistedCard = CardRecord & {
  relativePath: string;
  modifiedAt: string;
  version: AssetVersion;
};

export type SavedCardResponse = {
  card: PersistedCard;
  saveReceipt: SaveReceipt;
} & ProjectionOutcome;

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
  context: LibraryOperationContext,
  sourceReadingId: string
): Promise<string> {
  try {
    return (await getReadingByIdInVault(context, sourceReadingId)).relativePath;
  } catch (error) {
    if (error instanceof ReadingServiceError) {
      throw error;
    }
    throw error;
  }
}

function cardResponse(
  card: CardRecord,
  receipt: SaveReceipt,
  version: AssetVersion,
  projection: ProjectionOutcome = {
    projectionStatus: "fresh",
    projectionErrorId: null
  }
): SavedCardResponse {
  return {
    card: {
      ...card,
      relativePath: receipt.relativePath,
      modifiedAt: receipt.modifiedAt,
      version
    },
    saveReceipt: receipt,
    ...projection
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
  const index =
    (await readCachedIndexProjection(vaultPath)) ??
    (await readIndexProjection(vaultPath));
  return index.assets
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
  version: AssetVersion;
}> {
  const absolutePath = resolveInsideRoot(vaultPath, entry.relativePath);
  let raw: string;
  let modifiedAt: string;
  let version: AssetVersion;

  try {
    const information = await lstat(absolutePath);
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new CardServiceError(
        "CARD_PATH_UNSAFE",
        "Card Markdown path must be a real file inside the Vault"
      );
    }
    await assertRealPathInsideRoot(vaultPath, absolutePath);
    const versioned = await readVersionedText(absolutePath);
    raw = versioned.content;
    modifiedAt = versioned.modifiedAt;
    version = versioned.version;
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

  return { card, absolutePath, modifiedAt, version };
}

export async function createCardInVault(
  context: LibraryOperationContext,
  input: CardCreateInput
): Promise<SavedCardResponse> {
  const vaultPath = context.path;
  const sourceReading = await resolveSourceReadingPath(
    context,
    input.sourceReadingId
  );
  const directory = resolveInsideRoot(vaultPath, CARD_DIRECTORIES[input.type]);
  const targetPath = await allocateUniqueMarkdownPath(directory, input.title, {
    root: vaultPath
  });
  const relativePath = learningLibraryRelativePath(vaultPath, targetPath);
  const card = createInitialCardRecord(input, sourceReading);
  const reservedVersion = await readAssetVersion(targetPath);

  await runFileTransaction({
    vaultPath,
    vaultId: context.vaultId,
    operation: "card-create",
    assertCurrent: context.assertCurrent,
    targets: [
      {
        relativePath,
        content: serializeCardMarkdown(card),
        expectedVersion: reservedVersion
      }
    ]
  });
  const saved = await readVersionedText(targetPath);
  const projection = await refreshIndexProjection(vaultPath, context.signal);

  return cardResponse(
    card,
    createSaveReceipt(
      relativePath,
      await realpath(targetPath),
      saved.modifiedAt
    ),
    saved.version,
    projection
  );
}

export async function getCardByIdInVault(
  context: LibraryOperationContext,
  id: string
): Promise<PersistedCard> {
  const vaultPath = context.path;
  context.assertCurrent();
  await assertInitializedVault(vaultPath);
  const entry = await findCardIndexEntry(vaultPath, id);
  const parsed = await readCardAtIndexEntry(vaultPath, entry);

  return {
    ...parsed.card,
    relativePath: entry.relativePath,
    modifiedAt: parsed.modifiedAt,
    version: parsed.version
  };
}

export async function listRecentCardsInVault(
  context: LibraryOperationContext,
  limit: number
): Promise<RecentCard[]> {
  const vaultPath = context.path;
  context.assertCurrent();
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
          modifiedAt: parsed.modifiedAt,
          version: parsed.version
      })
    );
  }

  return cards;
}

async function updateCardUnlocked(
  context: LibraryOperationContext,
  id: string,
  body: unknown
): Promise<SavedCardResponse> {
  const vaultPath = context.path;
  const entry = await findCardIndexEntry(vaultPath, id);
  if (entry.archived) {
    throw new CardServiceError(
      "CARD_ALREADY_ARCHIVED",
      "Archived cards cannot be updated",
      409
    );
  }
  const existing = await readCardAtIndexEntry(vaultPath, entry);
  const envelope = cardUpdateEnvelopeSchema.parse(body);
  const { expectedVersion, ...cardBody } = envelope;
  const input = parseCardUpdateInput(existing.card.type, cardBody);
  await assertAssetVersion(
    existing.absolutePath,
    entry.relativePath,
    expectedVersion
  );
  const sourceReading = await resolveSourceReadingPath(
    context,
    input.sourceReadingId
  );
  const updated = updateCardRecord(existing.card, input, sourceReading);
  await runFileTransaction({
    vaultPath,
    vaultId: context.vaultId,
    operation: "card-update",
    assertCurrent: context.assertCurrent,
    targets: [{
      relativePath: entry.relativePath,
      content: serializeCardMarkdown(updated),
      expectedVersion
    }]
  });
  const saved = await readVersionedText(existing.absolutePath);
  const projection = await refreshIndexProjection(vaultPath, context.signal);

  return cardResponse(
    updated,
    createSaveReceipt(
      entry.relativePath,
      await realpath(existing.absolutePath),
      saved.modifiedAt
    ),
    saved.version,
    projection
  );
}

export async function updateCardInVault(
  context: LibraryOperationContext,
  id: string,
  body: unknown
): Promise<SavedCardResponse> {
  return withCardLock(id, () => updateCardUnlocked(context, id, body));
}

async function archiveCardUnlocked(
  context: LibraryOperationContext,
  id: string,
  body: unknown
): Promise<SavedCardResponse> {
  const vaultPath = context.path;
  const parsedInput = archiveInputSchema.safeParse(body);
  if (!parsedInput.success) {
    throw new CardServiceError(
      "INVALID_ARCHIVE_CONFIRMATION",
      "Archive requires confirmed: true"
    );
  }

  const entry = await findCardIndexEntry(vaultPath, id);
  if (entry.archived) {
    throw new CardServiceError(
      "CARD_ALREADY_ARCHIVED",
      "Card is already archived",
      409
    );
  }

  const existing = await readCardAtIndexEntry(vaultPath, entry);
  const expectedVersion = parsedInput.data.expectedVersion;
  await assertAssetVersion(
    existing.absolutePath,
    entry.relativePath,
    expectedVersion
  );
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

  await runFileTransaction({
    vaultPath,
    vaultId: context.vaultId,
    operation: "card-archive",
    assertCurrent: context.assertCurrent,
    targets: [
      {
        relativePath: archiveRelativePath,
        content: serializeCardMarkdown(archived),
        expectedVersion: null
      },
      {
        relativePath: entry.relativePath,
        content: null,
        expectedVersion
      }
    ]
  });
  const archivedSaved = await readVersionedText(archiveAbsolutePath);
  const projection = await refreshIndexProjection(vaultPath, context.signal);
  return cardResponse(
    archived,
    createSaveReceipt(
      archiveRelativePath,
      await realpath(archiveAbsolutePath),
      archivedSaved.modifiedAt
    ),
    archivedSaved.version,
    projection
  );
}

export async function archiveCardInVault(
  context: LibraryOperationContext,
  id: string,
  body: unknown
): Promise<SavedCardResponse> {
  return withCardLock(id, () => archiveCardUnlocked(context, id, body));
}
