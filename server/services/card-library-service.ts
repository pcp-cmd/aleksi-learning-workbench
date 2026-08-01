import { createHash } from "node:crypto";
import { z } from "zod";
import { CARD_LABELS } from "../../shared/card-labels";
import { CARD_TYPES, type CardType } from "../../shared/card-types";
import type { LibraryOperationContext } from "../persistence/library-context";
import { readProjectionHealth } from "../projections/projection-health";
import {
  readCachedIndexProjection,
  type IndexDocument,
  type IndexEntry
} from "./index-service";
import { assertInitializedVault } from "./vault-service";

export type CardLibrarySort = "updated" | "created" | "title" | "due";
export type CardLibraryOrder = "asc" | "desc";
export type CardLibraryDueFilter = "overdue" | "today" | "future" | "none";

export type CardLibraryQuery = Readonly<{
  cursor?: string;
  limit: number;
  query?: string;
  type?: CardType;
  mastery?: "learning" | "due" | "mastered" | "rebuild" | "archived";
  due?: CardLibraryDueFilter;
  sort: CardLibrarySort;
  order: CardLibraryOrder;
}>;

export type CardLibraryItem = Readonly<{
  id: string;
  title: string;
  concept: string | null;
  type: CardType;
  typeLabel: string;
  mastery: IndexEntry["mastery"];
  nextReview: string | null;
  createdAt: string | null;
  updatedAt: string;
  archived: boolean;
}>;

type CardLibraryCursor = Readonly<{
  fingerprint: string;
  offset: number;
  queryHash: string;
  version: 1;
}>;

export type CardLibraryResult = Readonly<{
  cards: CardLibraryItem[];
  pageInfo: {
    hasMore: boolean;
    nextCursor: string | null;
  };
  degraded: {
    active: boolean;
    parseErrorCount: number;
    recoveryAction: "rebuild-index" | null;
  };
}>;

type CardLibraryQueryScope = Readonly<{
  generation: number;
  vaultId: string;
}>;

const cursorSchema = z
  .object({
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    offset: z.number().int().nonnegative(),
    queryHash: z.string().regex(/^[0-9a-f]{64}$/u),
    version: z.literal(1)
  })
  .strict();

export class CardLibraryServiceError extends Error {
  readonly code = "CARD_LIBRARY_CURSOR_STALE";
  readonly status = 409;

  constructor() {
    super("The card-library cursor no longer matches this query or index");
    this.name = "CardLibraryServiceError";
  }
}

function isCardEntry(entry: IndexEntry): entry is IndexEntry & {
  assetType: CardType;
} {
  return (CARD_TYPES as readonly string[]).includes(entry.assetType);
}

function normalizedSearch(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase();
}

function queryHash(
  query: CardLibraryQuery,
  today: string,
  scope?: CardLibraryQueryScope
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        due: query.due ?? null,
        limit: query.limit,
        mastery: query.mastery ?? null,
        order: query.order,
        query: query.query === undefined ? null : normalizedSearch(query.query),
        sort: query.sort,
        type: query.type ?? null,
        today,
        vaultGeneration: scope?.generation ?? null,
        vaultId: scope?.vaultId ?? null
      })
    )
    .digest("hex");
}

function decodeCursor(
  raw: string | undefined,
  index: IndexDocument,
  hash: string
): number {
  if (raw === undefined) {
    return 0;
  }
  try {
    const cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    ) as CardLibraryCursor;
    if (
      cursor.fingerprint !== index.sourceFingerprint ||
      cursor.queryHash !== hash
    ) {
      throw new CardLibraryServiceError();
    }
    return cursor.offset;
  } catch (error) {
    if (error instanceof CardLibraryServiceError) {
      throw error;
    }
    throw new CardLibraryServiceError();
  }
}

function encodeCursor(
  index: IndexDocument,
  hash: string,
  offset: number
): string {
  const cursor: CardLibraryCursor = {
    fingerprint: index.sourceFingerprint,
    offset,
    queryHash: hash,
    version: 1
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function dueMatches(
  entry: IndexEntry,
  filter: CardLibraryDueFilter | undefined,
  today: string
): boolean {
  if (filter === undefined) return true;
  if (filter === "none") return entry.nextReview === null;
  if (entry.nextReview === null) return false;
  if (filter === "overdue") return entry.nextReview < today;
  if (filter === "today") return entry.nextReview === today;
  return entry.nextReview > today;
}

function sortValue(entry: IndexEntry, sort: CardLibrarySort): string | null {
  if (sort === "title") return entry.title.normalize("NFC").toLocaleLowerCase();
  if (sort === "due") return entry.nextReview;
  if (sort === "created") return entry.createdAt ?? null;
  return entry.updatedAt;
}

function compareEntries(
  left: IndexEntry,
  right: IndexEntry,
  query: CardLibraryQuery
): number {
  const leftValue = sortValue(left, query.sort);
  const rightValue = sortValue(right, query.sort);
  if (leftValue === null && rightValue !== null) return 1;
  if (leftValue !== null && rightValue === null) return -1;
  const compared = (leftValue ?? "").localeCompare(rightValue ?? "");
  if (compared !== 0) {
    return query.order === "asc" ? compared : -compared;
  }
  return left.id.localeCompare(right.id);
}

function libraryItem(entry: IndexEntry & { assetType: CardType }): CardLibraryItem {
  return {
    id: entry.id,
    title: entry.title,
    concept: entry.concept,
    type: entry.assetType,
    typeLabel: CARD_LABELS[entry.assetType].label,
    mastery: entry.mastery,
    nextReview: entry.nextReview,
    createdAt: entry.createdAt ?? null,
    updatedAt: entry.updatedAt,
    archived: entry.archived
  };
}

export function queryCardLibraryIndex(
  index: IndexDocument,
  query: CardLibraryQuery,
  today: string,
  scope?: CardLibraryQueryScope
): CardLibraryResult {
  const search =
    query.query === undefined ? null : normalizedSearch(query.query);
  const filtered = index.assets
    .filter(isCardEntry)
    .filter(
      (entry) =>
        search === null ||
        normalizedSearch(entry.title).includes(search) ||
        normalizedSearch(entry.concept ?? "").includes(search)
    )
    .filter((entry) => query.type === undefined || entry.assetType === query.type)
    .filter(
      (entry) =>
        query.mastery === undefined || entry.mastery === query.mastery
    )
    .filter((entry) => dueMatches(entry, query.due, today))
    .sort((left, right) => compareEntries(left, right, query));
  const hash = queryHash(query, today, scope);
  const offset = decodeCursor(query.cursor, index, hash);
  const cards = filtered.slice(offset, offset + query.limit).map(libraryItem);
  const nextOffset = offset + cards.length;
  const hasMore = nextOffset < filtered.length;
  const parseErrorCount = index.parseErrors.length;
  const requiresCreatedAtRebuild =
    query.sort === "created" &&
    filtered.some((entry) => entry.createdAt === null || entry.createdAt === undefined);
  const degraded = parseErrorCount > 0 || requiresCreatedAtRebuild;

  return {
    cards,
    pageInfo: {
      hasMore,
      nextCursor: hasMore ? encodeCursor(index, hash, nextOffset) : null
    },
    degraded: {
      active: degraded,
      parseErrorCount,
      recoveryAction: degraded ? "rebuild-index" : null
    }
  };
}

export async function listCardLibraryInVault(
  context: LibraryOperationContext,
  query: CardLibraryQuery
): Promise<CardLibraryResult> {
  context.assertCurrent();
  await assertInitializedVault(context.path);
  const index = await readCachedIndexProjection(context.path);
  context.assertCurrent();
  if (index === null) {
    return {
      cards: [],
      pageInfo: { hasMore: false, nextCursor: null },
      degraded: {
        active: true,
        parseErrorCount: 0,
        recoveryAction: "rebuild-index"
      }
    };
  }
  const result = queryCardLibraryIndex(
    index,
    query,
    new Date().toISOString().slice(0, 10),
    { generation: context.generation, vaultId: context.vaultId }
  );
  const health = await readProjectionHealth(context.path, "index");
  context.assertCurrent();
  if (health?.status !== "stale") {
    return result;
  }
  return {
    ...result,
    degraded: {
      ...result.degraded,
      active: true,
      recoveryAction: "rebuild-index"
    }
  };
}
