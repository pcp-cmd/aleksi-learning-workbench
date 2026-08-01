import { describe, expect, it } from "vitest";
import {
  LAST_SAFE_ROUTE_STORAGE_KEY,
  readLastSafeRoute,
  sanitizeRestorableLocation,
  writeLastSafeRoute
} from "../../src/app/route-restore";

describe("desktop safe route restoration", () => {
  it("keeps only stable route context and drops transient or unknown parameters", () => {
    expect(
      sanitizeRestorableLocation(
        "/reader",
        "?reading=reading-123&import=1720000000&unknown=value"
      )
    ).toBe("/reader?reading=reading-123");
    expect(
      sanitizeRestorableLocation(
        "/graph",
        "?concept=%E7%A7%AF%E5%88%86&stage=boundary&debug=true"
      )
    ).toBe("/graph?concept=%E7%A7%AF%E5%88%86&stage=boundary");
    expect(
      sanitizeRestorableLocation(
        "/verification",
        "?cardId=card-1&evidenceId=evidence-abc"
      )
    ).toBe("/verification?cardId=card-1&evidenceId=evidence-abc");
  });

  it("falls back to Today for stale routes and volatile Diagnosis context", () => {
    expect(sanitizeRestorableLocation("/removed-route", "?cardId=card-1")).toBe("/today");
    expect(sanitizeRestorableLocation("/diagnosis", "?cardId=card-1")).toBe("/today");
    expect(sanitizeRestorableLocation("/reader", "?reading=%3Cscript%3E")).toBe("/reader");
  });

  it("round-trips a versioned safe record and rejects malformed storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    writeLastSafeRoute(storage, "/review", "?cardId=card-7&concept=%E7%A7%AF%E5%88%86");
    expect(readLastSafeRoute(storage)).toBe(
      "/review?cardId=card-7&concept=%E7%A7%AF%E5%88%86"
    );

    values.set(LAST_SAFE_ROUTE_STORAGE_KEY, "not-json");
    expect(readLastSafeRoute(storage)).toBe("/today");
    values.set(
      LAST_SAFE_ROUTE_STORAGE_KEY,
      JSON.stringify({ version: 2, path: "/cards?cardId=card-7" })
    );
    expect(readLastSafeRoute(storage)).toBe("/today");
  });
});
