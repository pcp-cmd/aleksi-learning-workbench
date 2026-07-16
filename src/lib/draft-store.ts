export const DRAFT_SCHEMA_VERSION = 1 as const;

const DRAFT_STORAGE_PREFIX = `aleksi-workbench.draft.v${DRAFT_SCHEMA_VERSION}`;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_BYTES = 256 * 1_024;

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
    storage?.removeItem(storageKey(libraryKey));
  };

  const read = (
    libraryKey: string,
    readOptions: DraftReadOptions = {}
  ): StoredDraft<T> | null => {
    if (storage === null) {
      return null;
    }

    const key = storageKey(libraryKey);
    const raw = storage.getItem(key);
    if (raw === null) {
      return null;
    }

    try {
      if (byteLength(raw) > maxBytes) {
        throw new Error("draft exceeds its storage limit");
      }
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
      if (age < 0 || age > maxAgeMs) {
        throw new Error("draft has expired");
      }

      if (readOptions.validSourceIds !== undefined) {
        const validSourceIds = new Set(readOptions.validSourceIds);
        if (parsed.sourceIds.some((sourceId) => !validSourceIds.has(sourceId))) {
          throw new Error("draft source no longer exists");
        }
      }

      return parsed as StoredDraft<T>;
    } catch {
      storage.removeItem(key);
      return null;
    }
  };

  const write = (
    libraryKey: string,
    payload: T,
    writeOptions: DraftWriteOptions = {}
  ) => {
    if (storage === null) {
      return;
    }
    if (!options.validate(payload)) {
      throw new Error("草稿内容无效");
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
      throw new Error("草稿过大，无法安全保存到本地");
    }
    storage.setItem(storageKey(libraryKey), serialized);
  };

  const clearAll = () => {
    if (storage === null) {
      return;
    }
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(namespace)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => storage.removeItem(key));
  };

  return {
    clear,
    clearAll,
    read,
    storageKey,
    write
  };
}
