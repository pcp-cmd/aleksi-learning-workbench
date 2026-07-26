import { moveDraftStorageLibrary } from "./draft-store";

const LEGACY_ACTIVE_LIBRARY_DRAFT_KEY = "active-library";
const ACTIVE_LIBRARY_STORAGE_KEY =
  "aleksi-workbench.active-library-draft-key.v1";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function normalizedLibraryPath(path: string): string {
  return path.trim().replaceAll("/", "\\").replace(/[\\]+$/u, "").toLocaleLowerCase();
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function libraryDraftKey(path: string): string {
  return `library-${fnv1a(normalizedLibraryPath(path))}`;
}

export function activeLibraryDraftKey(
  localStorage: Storage | null = storage()
): string {
  return (
    localStorage?.getItem(ACTIVE_LIBRARY_STORAGE_KEY) ??
    LEGACY_ACTIVE_LIBRARY_DRAFT_KEY
  );
}

export function activateLibraryDraftIdentity(
  path: string,
  localStorage: Storage | null = storage()
): string {
  const nextKey = libraryDraftKey(path);
  if (localStorage === null) {
    return nextKey;
  }
  const previousKey = activeLibraryDraftKey(localStorage);
  if (previousKey === LEGACY_ACTIVE_LIBRARY_DRAFT_KEY) {
    moveDraftStorageLibrary(previousKey, nextKey, localStorage);
  }
  localStorage.setItem(ACTIVE_LIBRARY_STORAGE_KEY, nextKey);
  return nextKey;
}

export function switchLibraryDraftIdentity(
  previousPath: string | null,
  nextPath: string,
  localStorage: Storage | null = storage()
): string {
  if (previousPath !== null && previousPath.trim().length > 0) {
    activateLibraryDraftIdentity(previousPath, localStorage);
  }
  const nextKey = libraryDraftKey(nextPath);
  localStorage?.setItem(ACTIVE_LIBRARY_STORAGE_KEY, nextKey);
  return nextKey;
}
