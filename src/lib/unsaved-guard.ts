import { useEffect, useId, useRef } from "react";

export const UNSAVED_CHANGES_MESSAGE = "你有未保存的学习内容，确认要离开吗？";

const dirtyScopes = new Set<string>();
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

export function shouldBlockUnsavedNavigation(target: string): boolean {
  if (
    navigationPermit?.target === target &&
    navigationPermit.dirtyRevision === dirtyRevision
  ) {
    navigationPermit = null;
    return false;
  }
  return hasUnsavedChanges();
}

function isDesktopWebview(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

export function useUnsavedChanges(isDirty: boolean) {
  const scopeId = useId();
  const scopedId = `${activeGeneration}:${scopeId}`;
  const synchronouslyCommitted = useRef(false);
  if (!isDirty) synchronouslyCommitted.current = false;

  useEffect(() => {
    if (isDirty && !synchronouslyCommitted.current) {
      if (!dirtyScopes.has(scopedId)) {
        dirtyScopes.add(scopedId);
        markDirtyScopesChanged();
      }
    } else {
      if (dirtyScopes.delete(scopedId)) markDirtyScopesChanged();
    }

    return () => {
      if (dirtyScopes.delete(scopedId)) markDirtyScopesChanged();
    };
  }, [isDirty, scopedId]);

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
    if (dirtyScopes.delete(scopedId)) markDirtyScopesChanged();
  };
}
