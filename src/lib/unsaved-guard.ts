import { useEffect, useId } from "react";

export const UNSAVED_CHANGES_MESSAGE = "你有未保存的学习内容，确认要离开吗？";

const dirtyScopes = new Set<string>();
let activeGeneration = 0;
let approvedNavigation = false;

export function beginUnsavedGuardSession(): number {
  activeGeneration += 1;
  dirtyScopes.clear();
  return activeGeneration;
}

export function hasUnsavedChanges(): boolean {
  return dirtyScopes.size > 0;
}

export function confirmDiscardUnsavedChanges(): boolean {
  return !hasUnsavedChanges() || window.confirm(UNSAVED_CHANGES_MESSAGE);
}

export function confirmDiscardForNavigation(): boolean {
  if (!hasUnsavedChanges()) {
    return true;
  }
  const confirmed = window.confirm(UNSAVED_CHANGES_MESSAGE);
  if (confirmed) {
    approvedNavigation = true;
  }
  return confirmed;
}

export function shouldBlockUnsavedNavigation(): boolean {
  if (approvedNavigation) {
    approvedNavigation = false;
    return false;
  }
  return hasUnsavedChanges();
}

export function allowNextNavigationAfterCommit(): void {
  approvedNavigation = true;
}

export function useUnsavedChanges(isDirty: boolean) {
  const scopeId = useId();
  const scopedId = `${activeGeneration}:${scopeId}`;

  useEffect(() => {
    if (isDirty) {
      dirtyScopes.add(scopedId);
    } else {
      dirtyScopes.delete(scopedId);
    }

    return () => {
      dirtyScopes.delete(scopedId);
    };
  }, [isDirty, scopedId]);

  useEffect(() => {
    if (!isDirty) {
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
}
