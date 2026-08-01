import { useEffect, useId, useRef } from "react";

export const UNSAVED_CHANGES_MESSAGE = "你有未保存的学习内容，确认要离开吗？";

const dirtyScopes = new Set<string>();
const navigationRecoverableScopes = new Set<string>();
let activeGeneration = 0;
let dirtyRevision = 0;
let navigationPermit: Readonly<{
  target: string;
  dirtyRevision: number;
}> | null = null;

function markDirtyScopesChanged(): void {
  dirtyRevision += 1;
  navigationPermit = null;
}

export function beginUnsavedGuardSession(): number {
  activeGeneration += 1;
  if (dirtyScopes.size > 0) markDirtyScopesChanged();
  dirtyScopes.clear();
  navigationRecoverableScopes.clear();
  return activeGeneration;
}

export function hasUnsavedChanges(): boolean {
  return dirtyScopes.size > 0;
}

export function confirmDiscardUnsavedChanges(): boolean {
  return !hasUnsavedChanges() || window.confirm(UNSAVED_CHANGES_MESSAGE);
}

export function confirmDiscardForNavigation(target: string): boolean {
  if (!hasUnsavedChanges()) {
    return true;
  }
  const confirmed = window.confirm(UNSAVED_CHANGES_MESSAGE);
  if (confirmed) {
    navigationPermit = Object.freeze({ target, dirtyRevision });
  }
  return confirmed;
}

export function permitDraftPreservedNavigation(target: string): void {
  if (!hasUnsavedChanges()) return;
  navigationPermit = Object.freeze({ target, dirtyRevision });
}

export function shouldBlockUnsavedNavigation(target: string): boolean {
  if (
    navigationPermit?.target === target &&
    navigationPermit.dirtyRevision === dirtyRevision
  ) {
    navigationPermit = null;
    return false;
  }
  return Array.from(dirtyScopes).some(
    (scopeId) => !navigationRecoverableScopes.has(scopeId)
  );
}

function isDesktopWebview(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

export function useUnsavedChanges(
  isDirty: boolean,
  options: { navigationRecoverable?: boolean } = {}
) {
  const scopeId = useId();
  const scopedId = `${activeGeneration}:${scopeId}`;
  const synchronouslyCommitted = useRef(false);
  if (!isDirty) synchronouslyCommitted.current = false;

  useEffect(() => {
    if (isDirty && !synchronouslyCommitted.current) {
      const wasRecoverable = navigationRecoverableScopes.has(scopedId);
      if (!dirtyScopes.has(scopedId)) {
        dirtyScopes.add(scopedId);
        markDirtyScopesChanged();
      }
      if (options.navigationRecoverable === true) {
        navigationRecoverableScopes.add(scopedId);
      } else {
        navigationRecoverableScopes.delete(scopedId);
      }
      if (wasRecoverable !== navigationRecoverableScopes.has(scopedId)) {
        markDirtyScopesChanged();
      }
    } else {
      const dirtyChanged = dirtyScopes.delete(scopedId);
      const recoverableChanged = navigationRecoverableScopes.delete(scopedId);
      if (dirtyChanged || recoverableChanged) markDirtyScopesChanged();
    }

    return () => {
      const dirtyChanged = dirtyScopes.delete(scopedId);
      const recoverableChanged = navigationRecoverableScopes.delete(scopedId);
      if (dirtyChanged || recoverableChanged) markDirtyScopesChanged();
    };
  }, [isDirty, options.navigationRecoverable, scopedId]);

  useEffect(() => {
    if (!isDirty || isDesktopWebview()) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = UNSAVED_CHANGES_MESSAGE;
      return UNSAVED_CHANGES_MESSAGE;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  return () => {
    synchronouslyCommitted.current = true;
    const dirtyChanged = dirtyScopes.delete(scopedId);
    const recoverableChanged = navigationRecoverableScopes.delete(scopedId);
    if (dirtyChanged || recoverableChanged) markDirtyScopesChanged();
  };
}
