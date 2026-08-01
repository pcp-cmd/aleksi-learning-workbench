import { describe, expect, it } from "vitest";
import {
  addDays,
  nextReviewDate
} from "../../shared/date";

describe("review scheduling date logic", () => {
  it.each([
    ["forgot", 1],
    ["fuzzy", 3],
    ["known", 7],
    ["fluent", 14]
  ] as const)("schedules %s by %i UTC date-only days", (result, days) => {
    expect(nextReviewDate("2026-06-22", result)).toBe(
      addDays("2026-06-22", days)
    );
  });

  it("does not cross timezone boundaries by constructing local-midnight dates", () => {
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(nextReviewDate("2026-12-31", "forgot")).toBe("2027-01-01");
  });
});
