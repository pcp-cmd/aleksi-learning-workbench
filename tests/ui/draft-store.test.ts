// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import {
  clearAllDraftStorage,
  createDraftStore,
  DRAFT_SCHEMA_VERSION,
  moveDraftStorageLibrary
} from "../../src/lib/draft-store";
import {
  activateLibraryDraftIdentity,
  activeLibraryDraftKey,
  libraryDraftKey,
  switchLibraryDraftIdentity
} from "../../src/lib/active-library-drafts";
import {
  dismissDraftPersistenceWarning,
  useDraftPersistenceWarning
} from "../../src/lib/draft-persistence-status";

type ExampleDraft = {
  body: string;
  title: string;
};

function isExampleDraft(value: unknown): value is ExampleDraft {
  return (
    typeof value === "object" &&
    value !== null &&
    "body" in value &&
    typeof value.body === "string" &&
    "title" in value &&
    typeof value.title === "string"
  );
}

function WarningProbe() {
  return createElement("span", null, useDraftPersistenceWarning());
}

describe("versioned local draft store", () => {
  beforeEach(() => {
    localStorage.clear();
    dismissDraftPersistenceWarning();
  });

  it("namespaces drafts by learning library and records source references", () => {
    let now = 1_000;
    const store = createDraftStore<ExampleDraft>({
      key: "reader",
      now: () => now,
      validate: isExampleDraft
    });

    store.write("vault-a", { body: "A", title: "材料 A" }, { sourceIds: ["reading-a"] });
    now = 2_000;
    store.write("vault-b", { body: "B", title: "材料 B" });

    expect(store.read("vault-a")).toMatchObject({
      payload: { body: "A", title: "材料 A" },
      savedAt: 1_000,
      sourceIds: ["reading-a"],
      version: DRAFT_SCHEMA_VERSION
    });
    expect(store.read("vault-b")?.payload.title).toBe("材料 B");
  });

  it("rejects corrupt, expired, oversized, and stale-source drafts", () => {
    let now = 10_000;
    const store = createDraftStore<ExampleDraft>({
      key: "card",
      maxAgeMs: 500,
      maxBytes: 240,
      now: () => now,
      validate: isExampleDraft
    });

    expect(
      store.write("vault-a", {
        body: "x".repeat(400),
        title: "too large"
      })
    ).toEqual({ ok: false, code: "DRAFT_TOO_LARGE" });

    store.write("vault-a", { body: "safe", title: "卡片" }, { sourceIds: ["reading-a"] });
    expect(store.read("vault-a", { validSourceIds: ["reading-b"] })).toBeNull();

    store.write("vault-a", { body: "safe", title: "卡片" });
    now = 10_501;
    expect(store.read("vault-a")).toBeNull();

    localStorage.setItem(store.storageKey("vault-a"), "not json");
    expect(store.read("vault-a")).toBeNull();
    expect(localStorage.getItem(store.storageKey("vault-a"))).toBeNull();
  });

  it("clears one library or every namespace entry without touching other storage", () => {
    const store = createDraftStore<ExampleDraft>({
      key: "diagnosis",
      validate: isExampleDraft
    });
    store.write("vault-a", { body: "a", title: "A" });
    store.write("vault-b", { body: "b", title: "B" });
    localStorage.setItem("unrelated", "keep");

    store.clear("vault-a");
    expect(store.read("vault-a")).toBeNull();
    expect(store.read("vault-b")).not.toBeNull();

    store.clearAll();
    expect(store.read("vault-b")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("clears drafts across every feature namespace without touching unrelated storage", () => {
    const readerStore = createDraftStore<ExampleDraft>({
      key: "reader",
      validate: isExampleDraft
    });
    const reviewStore = createDraftStore<ExampleDraft>({
      key: "review",
      validate: isExampleDraft
    });
    readerStore.write("vault-a", { body: "reader", title: "Reader" });
    reviewStore.write("vault-a", { body: "review", title: "Review" });
    localStorage.setItem("unrelated", "keep");

    clearAllDraftStorage(localStorage);

    expect(readerStore.read("vault-a")).toBeNull();
    expect(reviewStore.read("vault-a")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("moves legacy envelopes into a deterministic library namespace", () => {
    const store = createDraftStore<ExampleDraft>({
      key: "library-transition",
      validate: isExampleDraft
    });
    store.write("active-library", { body: "safe", title: "Legacy" });

    const adoptedKey = activateLibraryDraftIdentity("C:\\Vaults\\Calculus");

    expect(adoptedKey).toBe(libraryDraftKey("c:/vaults/calculus/"));
    expect(activeLibraryDraftKey()).toBe(adoptedKey);
    expect(store.read(adoptedKey)?.payload.title).toBe("Legacy");
    expect(store.read("active-library")).toBeNull();
  });

  it("switches identities without deleting either library's drafts", () => {
    const store = createDraftStore<ExampleDraft>({
      key: "library-preservation",
      validate: isExampleDraft
    });
    const first = activateLibraryDraftIdentity("C:\\Vaults\\First");
    store.write(first, { body: "first", title: "First" });
    const second = libraryDraftKey("C:\\Vaults\\Second");
    store.write(second, { body: "second", title: "Second" });

    switchLibraryDraftIdentity("C:\\Vaults\\First", "C:\\Vaults\\Second");

    expect(activeLibraryDraftKey()).toBe(second);
    expect(store.read(first)?.payload.body).toBe("first");
    expect(store.read(second)?.payload.body).toBe("second");
  });

  it("does not overwrite an existing destination during a low-level move", () => {
    const store = createDraftStore<ExampleDraft>({
      key: "library-collision",
      validate: isExampleDraft
    });
    store.write("from", { body: "from", title: "From" });
    store.write("to", { body: "to", title: "To" });

    moveDraftStorageLibrary("from", "to", localStorage);

    expect(store.read("from")?.payload.body).toBe("from");
    expect(store.read("to")?.payload.body).toBe("to");
  });

  it("retains a readable in-memory draft when persistent storage rejects writes", () => {
    render(createElement(WarningProbe));
    const blockedStorage = {
      get length(): number {
        throw new DOMException("blocked", "SecurityError");
      },
      clear() {
        throw new DOMException("blocked", "SecurityError");
      },
      getItem() {
        throw new DOMException("blocked", "SecurityError");
      },
      key() {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem() {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem() {
        throw new DOMException("quota", "QuotaExceededError");
      }
    } satisfies Storage;
    const store = createDraftStore<ExampleDraft>({
      key: "blocked-storage",
      storage: blockedStorage,
      validate: isExampleDraft
    });

    let result: ReturnType<typeof store.write> | undefined;
    act(() => {
      result = store.write("vault-a", { body: "safe", title: "Memory" });
    });
    expect(result).toEqual({
      ok: true,
      persisted: false,
      warning: "DRAFT_NOT_PERSISTED"
    });
    expect(store.read("vault-a")?.payload.title).toBe("Memory");
    expect(
      screen.getByText(/只能保留在本次运行的内存中/u)
    ).toBeInTheDocument();
  });

  it("keeps the source draft when destination migration cannot be verified", () => {
    const store = createDraftStore<ExampleDraft>({
      key: "migration-rollback",
      validate: isExampleDraft
    });
    store.write("from", { body: "source", title: "Source" });
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const failingStorage = {
      get length() {
        return localStorage.length;
      },
      clear: () => localStorage.clear(),
      getItem: (key: string) => localStorage.getItem(key),
      key: (index: number) => localStorage.key(index),
      removeItem: (key: string) => localStorage.removeItem(key),
      setItem(key: string, value: string) {
        if (key.endsWith(":to")) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        originalSetItem(key, value);
      }
    } satisfies Storage;

    expect(moveDraftStorageLibrary("from", "to", failingStorage)).toEqual({
      ok: false,
      code: "DRAFT_MIGRATION_NOT_PERSISTED",
      moved: 0
    });
    expect(store.read("from")?.payload.body).toBe("source");
    expect(store.read("to")).toBeNull();
  });
});
