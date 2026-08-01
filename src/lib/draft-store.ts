export const DRAFT_SCHEMA_VERSION = 1 as const;

const DRAFT_STORAGE_PREFIX = `aleksi-workbench.draft.v${DRAFT_SCHEMA_VERSION}`;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_BYTES = 256 * 1_024;
const draftMemory = new Map<string, string>();

export type StoredDraft<T> = {
  libraryKey: string;
  payload: T;
  savedAt: number;
  sourceIds: string[];
  version: typeof DRAFT_SCHEMA_VERSION;
};

type DraftReadOptions = {
  validSourceIds?: readonly string[];
};

type DraftWriteOptions = {
  sourceIds?: readonly string[];
};

export type DraftWriteResult =
  | { ok: true; persisted: true }
  | { ok: true; persisted: false; warning: "DRAFT_NOT_PERSISTED" }
  | { ok: false; code: "INVALID_DRAFT" | "DRAFT_TOO_LARGE" };

export type DraftMigrationResult =
  | { ok: true; moved: number }
  | { ok: false; code: "DRAFT_MIGRATION_NOT_PERSISTED"; moved: number };

type DraftStoreOptions<T> = {
  key: string;
  maxAgeMs?: number;
  maxBytes?: number;
  now?: () => number;
  storage?: Storage;
  validate: (value: unknown) => value is T;
};

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function clearAllDraftStorage(
  storage: Storage | null = defaultStorage()
): void {
  for (const key of draftMemory.keys()) {
    if (key.startsWith(`${DRAFT_STORAGE_PREFIX}:`)) draftMemory.delete(key);
  }
  if (storage === null) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${DRAFT_STORAGE_PREFIX}:`)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Browser policy may disable persistent storage.
  }
}

export function moveDraftStorageLibrary(
  fromLibraryKey: string,
  toLibraryKey: string,
  storage: Storage | null = defaultStorage()
): DraftMigrationResult {
  if (
    storage === null ||
    fromLibraryKey === toLibraryKey ||
    fromLibraryKey.length === 0 ||
    toLibraryKey.length === 0
  ) {
    return { ok: true, moved: 0 };
  }

  let moved = 0;
  try {
    const fromSuffix = `:${encodeURIComponent(fromLibraryKey)}`;
    const moves: Array<{ from: string; to: string; value: string }> = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (
        key === null ||
        !key.startsWith(`${DRAFT_STORAGE_PREFIX}:`) ||
        !key.endsWith(fromSuffix)
      ) {
        continue;
      }
      const value = storage.getItem(key);
      if (value === null) continue;
      const to = `${key.slice(0, -fromSuffix.length)}:${encodeURIComponent(
        toLibraryKey
      )}`;
      if (storage.getItem(to) !== null) continue;
      const envelope = JSON.parse(value) as Record<string, unknown>;
      envelope.libraryKey = toLibraryKey;
      moves.push({ from: key, to, value: JSON.stringify(envelope) });
    }

    for (const move of moves) {
      storage.setItem(move.to, move.value);
      if (storage.getItem(move.to) !== move.value) {
        return {
          ok: false,
          code: "DRAFT_MIGRATION_NOT_PERSISTED",
          moved
        };
      }
      storage.removeItem(move.from);
      moved += 1;
    }
    return { ok: true, moved };
  } catch {
    return {
      ok: false,
      code: "DRAFT_MIGRATION_NOT_PERSISTED",
      moved
    };
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizedSourceIds(sourceIds: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (sourceIds ?? [])
        .map((sourceId) => sourceId.trim())
        .filter((sourceId) => sourceId.length > 0)
    )
  );
}

export function createDraftStore<T>(options: DraftStoreOptions<T>) {
  const namespace = `${DRAFT_STORAGE_PREFIX}:${encodeURIComponent(options.key)}:`;
  const storage = options.storage ?? defaultStorage();
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const storageKey = (libraryKey: string) =>
    `${namespace}${encodeURIComponent(libraryKey)}`;

  const clear = (libraryKey: string) => {
    const key = storageKey(libraryKey);
    draftMemory.delete(key);
    try {
      storage?.removeItem(key);
    } catch {
      // The in-memory copy is already cleared.
    }
  };

  const read = (
    libraryKey: string,
    readOptions: DraftReadOptions = {}
  ): StoredDraft<T> | null => {
    const key = storageKey(libraryKey);
    let raw: string | null = null;
    if (storage !== null) {
      try {
        raw = storage.getItem(key);
      } catch {
        raw = draftMemory.get(key) ?? null;
      }
    }
    if (raw === null) raw = draftMemory.get(key) ?? null;
    if (raw === null) return null;

    try {
      if (byteLength(raw) > maxBytes) throw new Error("draft is too large");
      const parsed = JSON.parse(raw) as Partial<StoredDraft<unknown>>;
      if (
        parsed.version !== DRAFT_SCHEMA_VERSION ||
        parsed.libraryKey !== libraryKey ||
        typeof parsed.savedAt !== "number" ||
        !Number.isFinite(parsed.savedAt) ||
        parsed.savedAt < 0 ||
        !Array.isArray(parsed.sourceIds) ||
        !parsed.sourceIds.every((sourceId) => typeof sourceId === "string") ||
        !options.validate(parsed.payload)
      ) {
        throw new Error("draft envelope is invalid");
      }
      const age = now() - parsed.savedAt;
      if (age < 0 || age > maxAgeMs) throw new Error("draft has expired");
      if (readOptions.validSourceIds !== undefined) {
        const valid = new Set(readOptions.validSourceIds);
        if (parsed.sourceIds.some((sourceId) => !valid.has(sourceId))) {
          throw new Error("draft source no longer exists");
        }
      }
      return parsed as StoredDraft<T>;
    } catch {
      draftMemory.delete(key);
      try {
        storage?.removeItem(key);
      } catch {
        // Invalid persistent data remains inaccessible until storage recovers.
      }
      return null;
    }
  };

  const write = (
    libraryKey: string,
    payload: T,
    writeOptions: DraftWriteOptions = {}
  ): DraftWriteResult => {
    if (!options.validate(payload)) {
      const result = { ok: false, code: "INVALID_DRAFT" } as const;
      reportDraftWriteResult(result);
      return result;
    }
    const envelope: StoredDraft<T> = {
      version: DRAFT_SCHEMA_VERSION,
      libraryKey,
      payload,
      savedAt: now(),
      sourceIds: normalizedSourceIds(writeOptions.sourceIds)
    };
    const serialized = JSON.stringify(envelope);
    if (byteLength(serialized) > maxBytes) {
      const result = { ok: false, code: "DRAFT_TOO_LARGE" } as const;
      reportDraftWriteResult(result);
      return result;
    }

    const key = storageKey(libraryKey);
    draftMemory.set(key, serialized);
    if (storage === null) {
      const result = {
        ok: true,
        persisted: false,
        warning: "DRAFT_NOT_PERSISTED"
      } as const;
      reportDraftWriteResult(result);
      return result;
    }
    try {
      storage.setItem(key, serialized);
      if (storage.getItem(key) !== serialized) {
        const result = {
          ok: true,
          persisted: false,
          warning: "DRAFT_NOT_PERSISTED"
        } as const;
        reportDraftWriteResult(result);
        return result;
      }
      draftMemory.delete(key);
      const result = { ok: true, persisted: true } as const;
      reportDraftWriteResult(result);
      return result;
    } catch {
      const result = {
        ok: true,
        persisted: false,
        warning: "DRAFT_NOT_PERSISTED"
      } as const;
      reportDraftWriteResult(result);
      return result;
    }
  };

  const clearAll = () => {
    for (const key of draftMemory.keys()) {
      if (key.startsWith(namespace)) draftMemory.delete(key);
    }
    if (storage === null) return;
    try {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(namespace)) keys.push(key);
      }
      keys.forEach((key) => storage.removeItem(key));
    } catch {
      // The in-memory copies are already cleared.
    }
  };

  return { clear, clearAll, read, storageKey, write };
}
import { reportDraftWriteResult } from "./draft-persistence-status";
