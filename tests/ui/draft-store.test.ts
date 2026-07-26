// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
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

describe("versioned local draft store", () => {
  beforeEach(() => localStorage.clear());

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

    expect(() =>
      store.write("vault-a", { body: "x".repeat(400), title: "too large" })
    ).toThrow("草稿过大");

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
});
