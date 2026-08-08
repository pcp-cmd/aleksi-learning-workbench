import { IndexAssetParseError, type IndexScanOptions } from "./index-contract";

export const MAX_INDEX_MARKDOWN_FILES = 10_000;
export const MAX_INDEX_MARKDOWN_BYTES = 12 * 1024 * 1024;
export const MAX_INDEX_TOTAL_ENTRIES = 50_000;
export const MAX_INDEX_DIRECTORY_DEPTH = 32;
export const MAX_INDEX_SCAN_DURATION_MS = 15_000;

export type IndexTraversalBudget = {
  signal?: AbortSignal;
  deadlineAt: number;
  entryCount: number;
  markdownCount: number;
  maxEntries: number;
  maxDepth: number;
};

export class IndexScanError extends Error {
  readonly code: "INDEX_ENTRY_LIMIT" | "INDEX_DEPTH_LIMIT" |
    "INDEX_SCAN_DEADLINE_EXCEEDED" | "INDEX_SCAN_ABORTED" | "INDEX_SOURCE_CHANGED";
  readonly status: number;
  constructor(code: IndexScanError["code"], message: string, status: number) {
    super(message);
    this.name = "IndexScanError";
    this.code = code;
    this.status = status;
  }
}

function boundedScanLimit(requested: number | undefined, hardMaximum: number, name: string) {
  if (requested === undefined) return hardMaximum;
  if (!Number.isSafeInteger(requested) || requested < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return Math.min(requested, hardMaximum);
}

export function createIndexTraversalBudget(options: IndexScanOptions): IndexTraversalBudget {
  const hardDeadline = Date.now() + MAX_INDEX_SCAN_DURATION_MS;
  const requestedDeadline = options.deadlineAt ?? hardDeadline;
  if (!Number.isFinite(requestedDeadline)) {
    throw new RangeError("Index scan deadline must be a finite epoch timestamp");
  }
  return {
    signal: options.signal,
    deadlineAt: Math.min(requestedDeadline, hardDeadline),
    entryCount: 0,
    markdownCount: 0,
    maxEntries: boundedScanLimit(options.limits?.maxEntries, MAX_INDEX_TOTAL_ENTRIES, "Index entry limit"),
    maxDepth: boundedScanLimit(options.limits?.maxDepth, MAX_INDEX_DIRECTORY_DEPTH, "Index directory depth limit")
  };
}

function deadlineError() {
  return new IndexScanError("INDEX_SCAN_DEADLINE_EXCEEDED",
    `Index scan exceeded the ${MAX_INDEX_SCAN_DURATION_MS} ms deadline`, 503);
}

export function assertIndexScanActive(budget: IndexTraversalBudget): void {
  if (budget.signal?.aborted === true) {
    throw new IndexScanError("INDEX_SCAN_ABORTED", "Index scan was cancelled", 503);
  }
  if (Date.now() >= budget.deadlineAt) throw deadlineError();
}

export async function withinIndexScanBudget<T>(budget: IndexTraversalBudget,
  operation: () => Promise<T>): Promise<T> {
  assertIndexScanActive(budget);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      budget.signal?.removeEventListener("abort", onAbort);
    };
    const resolveOnce = (value: T) => { if (!settled) { settled = true; cleanup(); resolve(value); } };
    const rejectOnce = (error: unknown) => { if (!settled) { settled = true; cleanup(); reject(error); } };
    const onAbort = () => rejectOnce(new IndexScanError("INDEX_SCAN_ABORTED", "Index scan was cancelled", 503));
    const timer = setTimeout(() => rejectOnce(deadlineError()), Math.max(1, budget.deadlineAt - Date.now()));
    budget.signal?.addEventListener("abort", onAbort, { once: true });
    try { void operation().then(resolveOnce, rejectOnce); } catch (error) { rejectOnce(error); }
  });
}

export async function acquireIndexResource<T extends { close(): Promise<void> }>(
  budget: IndexTraversalBudget, operation: () => Promise<T>): Promise<T> {
  const resourcePromise = operation();
  try { return await withinIndexScanBudget(budget, () => resourcePromise); }
  catch (error) {
    void resourcePromise.then((resource) => resource.close()).catch(() => undefined);
    throw error;
  }
}

export function countIndexEntry(budget: IndexTraversalBudget): void {
  budget.entryCount += 1;
  if (budget.entryCount > budget.maxEntries) {
    throw new IndexScanError("INDEX_ENTRY_LIMIT",
      `Learning library exceeds the ${budget.maxEntries} total filesystem entry limit`, 422);
  }
}

export function assertIndexDepth(depth: number, budget: IndexTraversalBudget, relativePath: string) {
  if (depth > budget.maxDepth) {
    throw new IndexScanError("INDEX_DEPTH_LIMIT",
      `${relativePath} exceeds the ${budget.maxDepth} directory depth limit`, 422);
  }
}

export function assertIndexFileCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Index file count must be a non-negative safe integer");
  }
  if (count > MAX_INDEX_MARKDOWN_FILES) {
    throw new IndexAssetParseError("INDEX_FILE_COUNT_LIMIT",
      `Learning library exceeds the ${MAX_INDEX_MARKDOWN_FILES} Markdown file count limit`);
  }
}
