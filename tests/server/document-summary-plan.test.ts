import { describe, expect, it } from "vitest";
import type { StoredDocumentIndex } from "../../shared/document-contract";
import { buildDocumentSummaryPlan } from "../../server/documents/document-summary-plan";

function documentWithTokenCounts(tokenCounts: number[]): StoredDocumentIndex {
  const documentId = "88888888-8888-4888-8888-888888888888";
  const chunks = tokenCounts.map((estimatedTokens, index) => ({
    chunkId: `chunk-${index}`,
    documentId,
    title: `Section ${index + 1}`,
    headingLevel: 1,
    headingPath: [`Section ${index + 1}`],
    sourceStartOffset: index * 100,
    sourceEndOffset: (index + 1) * 100,
    sourceStartLine: index * 5 + 1,
    sourceEndLine: (index + 1) * 5,
    contentHash: `${index}`.repeat(64).slice(0, 64),
    estimatedTokens,
    oversized: estimatedTokens > 1_000,
    plainText: `Section ${index + 1}`
  }));
  return {
    schemaVersion: 1,
    parserVersion: 1,
    documentId,
    sourcePath: "01-阅读材料/summary.md",
    sourceHash: "a".repeat(64),
    sourceVersion: { byteSize: 300, modifiedNanoseconds: "1", inode: "2" },
    title: "Summary",
    byteSize: 300,
    lineCount: 15,
    outline: [],
    chunks,
    definitionMarkdown: "",
    complexity: {
      mode: "large",
      reasons: ["oversized-block"],
      metrics: {
        byteSize: 300,
        lineCount: 15,
        astNodeCount: 3,
        headingCount: 3,
        paragraphCount: 3,
        mathBlockCount: 0,
        codeBlockCount: 0,
        tableCount: 0,
        estimatedRenderedNodeCount: 6,
        estimatedTokens: tokenCounts.reduce((sum, value) => sum + value, 0),
        maximumSingleBlockBytes: 200
      }
    },
    processingStatus: "ready",
    indexedAt: "2026-08-01T00:00:00.000Z",
    diagnostics: []
  };
}

describe("document summary planning", () => {
  it("never emits a section batch above budget and records indivisible omissions", () => {
    const plan = buildDocumentSummaryPlan(documentWithTokenCounts([300, 2_000, 300]), 1_000);
    const sectionBatches = plan.batches.filter((batch) => batch.level === "section");

    expect(sectionBatches.every((batch) => batch.estimatedTokens <= 800)).toBe(true);
    expect(plan.omittedOverBudgetChunkIds).toEqual(["chunk-1"]);
    expect(plan.batches.at(-1)?.inputChunkIds).toEqual(["chunk-0", "chunk-2"]);
  });
});
