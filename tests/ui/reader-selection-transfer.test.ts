// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  clearReaderSelectionPayload,
  readReaderSelectionPayload,
  READER_SELECTION_STORAGE_KEY,
  writeReaderSelectionPayload
} from "../../src/features/reader/reader-selection-transfer";

const payload = {
  source: "reader-selection",
  target: "cards",
  cardType: "concept",
  sourceReadingId: "11111111-1111-4111-8111-111111111111",
  sourcePath: "01-阅读材料/数列极限.md",
  concept: "ε-N",
  excerpt: "对任意 ε > 0，存在 N。"
} as const;

afterEach(() => {
  sessionStorage.clear();
});

describe("reader selection transfer", () => {
  it("writes, reads, validates, and clears the shared reader selection payload", () => {
    writeReaderSelectionPayload(payload);

    expect(READER_SELECTION_STORAGE_KEY).toBe("aleksi.readerSelection");
    expect(readReaderSelectionPayload()).toEqual(payload);

    clearReaderSelectionPayload();

    expect(readReaderSelectionPayload()).toBeNull();
    expect(sessionStorage.getItem(READER_SELECTION_STORAGE_KEY)).toBeNull();
  });

  it("ignores malformed payloads instead of leaking ad-hoc sessionStorage shapes", () => {
    sessionStorage.setItem(
      READER_SELECTION_STORAGE_KEY,
      JSON.stringify({
        source: "reader-selection",
        target: "cards",
        cardType: "definition",
        sourceReadingId: 123,
        sourcePath: "01-阅读材料/数列极限.md",
        concept: "ε-N",
        excerpt: "对任意 ε > 0，存在 N。"
      })
    );

    expect(readReaderSelectionPayload()).toBeNull();
  });
});
