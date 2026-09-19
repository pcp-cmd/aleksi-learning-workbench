import { describe, expect, it } from "vitest";
import {
  documentAwareSourceFingerprint,
  registeredReadingIndexEntry
} from "../../server/documents/global-index-bridge";
import type { DocumentRegistryEntry } from "../../shared/document-contract";

const baseDocument: DocumentRegistryEntry = {
  documentId: "document-1",
  readingId: "11111111-1111-4111-8111-111111111111",
  relativePath: "00-阅读/F00.md",
  title: "F00",
  concept: "Foundation",
  source: "file-import",
  sourceFileName: "F00.md",
  createdAt: "2026-09-19T00:00:00.000Z"
};

describe("document-aware index fingerprint", () => {
  it("changes whenever a registry field visible in the global index changes", () => {
    const baseline = documentAwareSourceFingerprint([], "2026-09-19", [
      baseDocument
    ]);
    const variants: DocumentRegistryEntry[] = [
      {
        ...baseDocument,
        readingId: "22222222-2222-4222-8222-222222222222"
      },
      {
        ...baseDocument,
        createdAt: "2026-09-20T00:00:00.000Z"
      },
      { ...baseDocument, title: "F00 updated" },
      { ...baseDocument, concept: "Updated foundation" },
      { ...baseDocument, relativePath: "00-阅读/F00-updated.md" }
    ];

    for (const variant of variants) {
      expect(
        documentAwareSourceFingerprint([], "2026-09-19", [variant])
      ).not.toBe(baseline);
    }
  });

  it("tracks the same registry identity fields used by the projected reading", () => {
    const entry = registeredReadingIndexEntry(baseDocument);
    expect(entry).toMatchObject({
      id: baseDocument.readingId,
      relativePath: baseDocument.relativePath,
      title: baseDocument.title,
      concept: baseDocument.concept,
      createdAt: baseDocument.createdAt
    });
  });
});
