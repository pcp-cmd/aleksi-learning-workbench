import { describe, expect, it, vi } from "vitest";
import { boundedMap } from "../../server/lib/bounded-map";
import { IoBudget } from "../../server/lib/io-budget";

describe("common I/O budget", () => {
  it("consumes file and byte limits monotonically", () => {
    const budget = new IoBudget({
      maxDepth: 2,
      maxFiles: 2,
      maxFileBytes: 5,
      maxTotalBytes: 8,
      maxConcurrency: 2,
      deadlineAt: Date.now() + 10_000
    });
    budget.claimFile(3, 1);
    expect(budget.snapshot()).toEqual({ files: 1, bytes: 3 });
    expect(() => budget.claimFile(6, 1)).toThrowError(
      expect.objectContaining({ code: "IO_FILE_SIZE_LIMIT" })
    );
    expect(budget.snapshot()).toEqual({ files: 1, bytes: 3 });
    budget.claimFile(5, 2);
    expect(budget.snapshot()).toEqual({ files: 2, bytes: 8 });
    expect(() => budget.claimFile(0, 0)).toThrowError(
      expect.objectContaining({ code: "IO_FILE_COUNT_LIMIT" })
    );
  });

  it("enforces depth, total bytes, deadline, and cancellation", () => {
    const budget = new IoBudget({
      maxDepth: 1,
      maxFiles: 5,
      maxFileBytes: 10,
      maxTotalBytes: 4,
      maxConcurrency: 1,
      deadlineAt: Date.now() + 10_000
    });
    expect(() => budget.claimFile(1, 2)).toThrowError(
      expect.objectContaining({ code: "IO_DEPTH_LIMIT" })
    );
    budget.claimFile(4, 1);
    expect(() => budget.claimFile(1, 1)).toThrowError(
      expect.objectContaining({ code: "IO_TOTAL_BYTES_LIMIT" })
    );
    const controller = new AbortController();
    controller.abort();
    expect(() => budget.checkpoint(controller.signal)).toThrowError(
      expect.objectContaining({ code: "IO_ABORTED" })
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const expired = new IoBudget({
      maxDepth: 1,
      maxFiles: 1,
      maxFileBytes: 1,
      maxTotalBytes: 1,
      maxConcurrency: 1,
      deadlineAt: Date.now() - 1
    });
    expect(() => expired.checkpoint()).toThrowError(
      expect.objectContaining({ code: "IO_DEADLINE_EXCEEDED", status: 503 })
    );
    vi.useRealTimers();
  });

  it("bounds concurrency while preserving input order", async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const resultPromise = boundedMap([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return value * 10;
    });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0, 2).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0, 2).forEach((release) => release());

    await expect(resultPromise).resolves.toEqual([10, 20, 30, 40]);
    expect(peak).toBe(2);
  });
});
