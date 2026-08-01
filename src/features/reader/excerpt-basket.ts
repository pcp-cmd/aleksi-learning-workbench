import { createDraftStore } from "../../lib/draft-store";
import { activeLibraryDraftKey } from "../../lib/active-library-drafts";

export type ExcerptBasketItem = {
  id: string;
  sourceReadingId: string;
  sourcePath: string;
  concept: string;
  excerptText: string;
  createdAt: string;
};

export type ExcerptBasketInput = Omit<ExcerptBasketItem, "createdAt" | "id">;

function fallbackId(now: Date): string {
  return `excerpt-${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isExcerptBasketItem(value: unknown): value is ExcerptBasketItem {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ExcerptBasketItem>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.sourceReadingId === "string" &&
    typeof candidate.sourcePath === "string" &&
    typeof candidate.concept === "string" &&
    typeof candidate.excerptText === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function isExcerptBasket(value: unknown): value is ExcerptBasketItem[] {
  return Array.isArray(value) && value.every(isExcerptBasketItem);
}

const excerptBasketStore = createDraftStore<ExcerptBasketItem[]>({
  key: "reader-excerpt-basket",
  validate: isExcerptBasket
});

export const EXCERPT_BASKET_STORAGE_KEY = excerptBasketStore.storageKey(
  "active-library"
);

export function readExcerptBasketItems(): ExcerptBasketItem[] {
  return excerptBasketStore.read(activeLibraryDraftKey())?.payload ?? [];
}

export function writeExcerptBasketItems(items: ExcerptBasketItem[]): void {
  excerptBasketStore.write(activeLibraryDraftKey(), items, {
    sourceIds: items.map((item) => item.sourceReadingId)
  });
}

export function createExcerptBasketItem(
  input: ExcerptBasketInput,
  now = new Date()
): ExcerptBasketItem {
  const id =
    typeof crypto.randomUUID === "function" ? crypto.randomUUID() : fallbackId(now);

  return {
    ...input,
    id,
    createdAt: now.toISOString()
  };
}
