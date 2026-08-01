import { moveDraftStorageLibrary } from "./draft-store";
import { getLibraryIdentity } from "./library-identity";
import { sha256Text } from "./sha256";

const LEGACY_ACTIVE_LIBRARY_DRAFT_KEY = "active-library";
const LEGACY_ACTIVE_LIBRARY_STORAGE_KEY =
  "aleksi-workbench.active-library-draft-key.v1";
const ACTIVE_LIBRARY_STORAGE_KEY =
  "aleksi-workbench.active-library-draft-key.v2";

type ActiveLibraryDraftMetadata = {
  canonicalPath: string;
  libraryKey: string;
  vaultId: string;
  version: 2;
};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function normalizedLibraryPath(path: string): string {
  return path
    .trim()
    .replaceAll("/", "\\")
    .replace(/[\\]+$/u, "")
    .toLocaleLowerCase();
}

function safeGet(localStorage: Storage, key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeMetadata(
  metadata: ActiveLibraryDraftMetadata,
  localStorage: Storage
): boolean {
  const serialized = JSON.stringify(metadata);
  try {
    localStorage.setItem(ACTIVE_LIBRARY_STORAGE_KEY, serialized);
    return localStorage.getItem(ACTIVE_LIBRARY_STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
}

export function libraryDraftKey(
  path: string,
  vaultId = getLibraryIdentity()?.vaultId ?? "path-only"
): string {
  const canonicalPath = normalizedLibraryPath(path);
  return `library-${sha256Text(`${vaultId}\u0000${canonicalPath}`)}`;
}

export function activeLibraryDraftKey(
  localStorage: Storage | null = storage()
): string {
  if (localStorage === null) return LEGACY_ACTIVE_LIBRARY_DRAFT_KEY;
  const metadataRaw = safeGet(localStorage, ACTIVE_LIBRARY_STORAGE_KEY);
  if (metadataRaw !== null) {
    try {
      const metadata = JSON.parse(metadataRaw) as Partial<ActiveLibraryDraftMetadata>;
      if (
        metadata.version === 2 &&
        typeof metadata.libraryKey === "string" &&
        metadata.libraryKey.startsWith("library-")
      ) {
        return metadata.libraryKey;
      }
    } catch {
      // Fall through to the legacy identity.
    }
  }
  return (
    safeGet(localStorage, LEGACY_ACTIVE_LIBRARY_STORAGE_KEY) ??
    LEGACY_ACTIVE_LIBRARY_DRAFT_KEY
  );
}

export function activateLibraryDraftIdentity(
  path: string,
  localStorage: Storage | null = storage()
): string {
  const canonicalPath = normalizedLibraryPath(path);
  const vaultId = getLibraryIdentity()?.vaultId ?? "path-only";
  const nextKey = libraryDraftKey(path, vaultId);
  if (localStorage === null) return nextKey;
  const previousKey = activeLibraryDraftKey(localStorage);
  if (previousKey === LEGACY_ACTIVE_LIBRARY_DRAFT_KEY) {
    const migration = moveDraftStorageLibrary(
      previousKey,
      nextKey,
      localStorage
    );
    if (!migration.ok) return previousKey;
  }
  const stored = writeMetadata(
    {
      canonicalPath,
      libraryKey: nextKey,
      vaultId,
      version: 2
    },
    localStorage
  );
  return stored ? nextKey : previousKey;
}

export function switchLibraryDraftIdentity(
  previousPath: string | null,
  nextPath: string,
  localStorage: Storage | null = storage()
): string {
  if (previousPath !== null && previousPath.trim().length > 0) {
    activateLibraryDraftIdentity(previousPath, localStorage);
  }
  const previousKey = activeLibraryDraftKey(localStorage);
  const canonicalPath = normalizedLibraryPath(nextPath);
  const vaultId = getLibraryIdentity()?.vaultId ?? "path-only";
  const nextKey = libraryDraftKey(nextPath, vaultId);
  if (
    localStorage !== null &&
    !writeMetadata(
      {
        canonicalPath,
        libraryKey: nextKey,
        vaultId,
        version: 2
      },
      localStorage
    )
  ) {
    return previousKey;
  }
  return nextKey;
}
