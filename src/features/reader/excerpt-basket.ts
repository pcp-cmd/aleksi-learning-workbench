export type ExcerptBasketItem = {
  id: string;
  sourceReadingId: string;
  sourcePath: string;
  concept: string;
  excerptText: string;
  createdAt: string;
};

export type ExcerptBasketInput = Omit<ExcerptBasketItem, "createdAt" | "id">;

export const EXCERPT_BASKET_STORAGE_KEY = "aleksi.excerptBasket";

function fallbackId(now: Date): string {
  return `excerpt-${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
}

function storage(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
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

export function readExcerptBasketItems(): ExcerptBasketItem[] {
  const raw = storage()?.getItem(EXCERPT_BASKET_STORAGE_KEY);
  if (raw === null || raw === undefined) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isExcerptBasketItem) : [];
  } catch {
    return [];
  }
}

export function writeExcerptBasketItems(items: ExcerptBasketItem[]): void {
  storage()?.setItem(EXCERPT_BASKET_STORAGE_KEY, JSON.stringify(items));
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
