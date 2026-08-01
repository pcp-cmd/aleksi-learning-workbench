import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  queryCardLibraryIndex,
  type CardLibraryQuery
} from "../../server/services/card-library-service";
import type { IndexDocument } from "../../server/services/index-service";

const QUERY: CardLibraryQuery = {
  limit: 50,
  query: "topology",
  sort: "title",
  order: "asc"
};

describe("10,000-card library performance", () => {
  it("C08 filters and paginates a synthetic index within the documented budget", () => {
    const index: IndexDocument = {
      generatedAt: "2026-07-29T10:00:00.000Z",
      sourceFingerprint: "b".repeat(64),
      parseErrors: [],
      assets: Array.from({ length: 10_000 }, (_, item) => ({
        id: `00000000-0000-4000-8000-${String(item).padStart(12, "0")}`,
        assetType: item % 2 === 0 ? "definition" : "reading",
        title: `Topology card ${String(item).padStart(5, "0")}`,
        concept: item % 3 === 0 ? "Topology" : "Analysis",
        relativePath: `02-定义卡/Card-${item}.md`,
        mastery: item % 5 === 0 ? "due" : "learning",
        nextReview: item % 5 === 0 ? "2026-07-28" : "2026-08-30",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
        archived: false
      }))
    };

    const startedAt = performance.now();
    const result = queryCardLibraryIndex(index, QUERY, "2026-07-29");
    const durationMs = performance.now() - startedAt;

    expect(result.cards).toHaveLength(50);
    expect(result.pageInfo.nextCursor).toEqual(expect.any(String));
    expect(durationMs).toBeLessThan(250);
  });
});
