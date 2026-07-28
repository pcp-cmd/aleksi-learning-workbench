import { describe, expect, it } from "vitest";
import { groupCommittedReviews } from "../../server/services/review-service";

describe("review history grouping", () => {
  it("groups and orders 10,000 records in one in-memory pass", () => {
    const records = Array.from({ length: 10_000 }, (_, index) => ({
      commitState: index % 23 === 0 ? "attempted" : "committed",
      cardId: `card-${index % 100}`,
      reviewSequence: 100 - Math.floor(index / 100)
    }));

    const grouped = groupCommittedReviews(records as never);

    expect(grouped.size).toBe(100);
    const committedCount = [...grouped.values()].reduce(
      (count, history) => count + history.length,
      0
    );
    expect(committedCount).toBe(
      records.filter((record) => record.commitState === "committed").length
    );
    for (const history of grouped.values()) {
      expect(history.map((record) => record.reviewSequence)).toEqual(
        history
          .map((record) => record.reviewSequence)
          .sort((a, b) => a - b)
      );
    }
  });
});
