// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginUnsavedGuardSession,
  confirmDiscardForNavigation,
  hasUnsavedChanges,
  permitDraftPreservedNavigation,
  shouldBlockUnsavedNavigation,
  useUnsavedChanges
} from "../../src/lib/unsaved-guard";

function DirtyScope({
  dirty,
  navigationRecoverable = false
}: {
  dirty: boolean;
  navigationRecoverable?: boolean;
}) {
  useUnsavedChanges(dirty, { navigationRecoverable });
  return null;
}

describe("target-bound unsaved navigation", () => {
  beforeEach(() => {
    beginUnsavedGuardSession();
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    beginUnsavedGuardSession();
  });

  it("consumes one permit only for its exact target", () => {
    render(<DirtyScope dirty />);
    expect(hasUnsavedChanges()).toBe(true);
    expect(confirmDiscardForNavigation("/cards?from=reader")).toBe(true);
    expect(shouldBlockUnsavedNavigation("/diagnosis")).toBe(true);
    expect(shouldBlockUnsavedNavigation("/cards?from=reader")).toBe(false);
    expect(shouldBlockUnsavedNavigation("/cards?from=reader")).toBe(true);
  });

  it("invalidates a permit when any dirty scope changes", () => {
    const view = render(
      <>
        <DirtyScope dirty />
        <DirtyScope dirty />
      </>
    );
    expect(confirmDiscardForNavigation("/cards")).toBe(true);
    view.rerender(
      <>
        <DirtyScope dirty={false} />
        <DirtyScope dirty />
      </>
    );
    expect(hasUnsavedChanges()).toBe(true);
    expect(shouldBlockUnsavedNavigation("/cards")).toBe(true);
  });

  it("allows one exact navigation after a recoverable draft is persisted", () => {
    render(<DirtyScope dirty />);
    permitDraftPreservedNavigation("/reader?reading=reading-1");

    expect(shouldBlockUnsavedNavigation("/cards")).toBe(true);
    permitDraftPreservedNavigation("/reader?reading=reading-1");
    expect(shouldBlockUnsavedNavigation("/reader?reading=reading-1")).toBe(false);
    expect(shouldBlockUnsavedNavigation("/reader?reading=reading-1")).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("allows history navigation for a locally recoverable draft while retaining dirty state", () => {
    render(<DirtyScope dirty navigationRecoverable />);

    expect(hasUnsavedChanges()).toBe(true);
    expect(shouldBlockUnsavedNavigation("/reader?reading=reading-1")).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
