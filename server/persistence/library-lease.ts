import {
  activeLearningLibraryIdentity,
  type LibraryContext,
  type LibraryIdentity
} from "./library-context";

export class ActiveLibraryChangedError extends Error {
  readonly code = "ACTIVE_LIBRARY_CHANGED";
  readonly status = 409;

  constructor() {
    super("The active learning library changed during this request");
    this.name = "ActiveLibraryChangedError";
  }
}

export class LibraryBusyError extends Error {
  readonly code = "LIBRARY_BUSY";
  readonly status = 409;

  constructor(readonly timeoutMs: number) {
    super(
      "The learning library is busy. Wait for the current operation to finish, then retry."
    );
    this.name = "LibraryBusyError";
  }
}

export type LibraryLease = {
  context: LibraryContext;
  assertCurrent(): void;
  release(): void;
};

type QueueEntry = {
  kind: "shared" | "exclusive";
  resolve: () => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abort?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
};

type ExclusiveLeaseOptions = {
  incrementGeneration?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

export class LibraryLeaseManager {
  private generation = 0;
  private activeReaders = 0;
  private activeWriter = false;
  private readonly queue: QueueEntry[] = [];

  constructor(
    private readonly resolveIdentity: () => Promise<LibraryIdentity> =
      activeLearningLibraryIdentity
  ) {}

  async acquireShared(signal?: AbortSignal): Promise<LibraryLease> {
    if (signal?.aborted === true) {
      throw abortError();
    }
    await this.acquire("shared", { signal });
    try {
      const identity = await this.resolveIdentity();
      const context = Object.freeze({
        ...identity,
        generation: this.generation
      });
      let released = false;
      return {
        context,
        assertCurrent: () => {
          if (context.generation !== this.generation) {
            throw new ActiveLibraryChangedError();
          }
        },
        release: () => {
          if (released) {
            return;
          }
          released = true;
          this.activeReaders -= 1;
          this.drain();
        }
      };
    } catch (error) {
      this.activeReaders -= 1;
      this.drain();
      throw error;
    }
  }

  async runExclusive<T>(
    operation: (nextGeneration: number) => Promise<T>,
    options: ExclusiveLeaseOptions = {}
  ): Promise<T> {
    await this.acquire("exclusive", options);
    const nextGeneration = this.generation + 1;
    try {
      const result = await operation(nextGeneration);
      if (options.incrementGeneration !== false) {
        this.generation = nextGeneration;
      }
      return result;
    } finally {
      this.activeWriter = false;
      this.drain();
    }
  }

  async runExclusiveWithContext<T>(
    operation: (nextGeneration: number) => Promise<T>,
    options: ExclusiveLeaseOptions = {}
  ): Promise<{ result: T; context: LibraryContext }> {
    await this.acquire("exclusive", options);
    const nextGeneration = this.generation + 1;
    try {
      const result = await operation(nextGeneration);
      if (options.incrementGeneration !== false) {
        this.generation = nextGeneration;
      }
      const identity = await this.resolveIdentity();
      return {
        result,
        context: Object.freeze({
          ...identity,
          generation: this.generation
        })
      };
    } finally {
      this.activeWriter = false;
      this.drain();
    }
  }

  async currentIdentity(): Promise<LibraryContext> {
    const lease = await this.acquireShared();
    try {
      return lease.context;
    } finally {
      lease.release();
    }
  }

  private acquire(
    kind: QueueEntry["kind"],
    options: Pick<ExclusiveLeaseOptions, "signal" | "timeoutMs"> = {}
  ): Promise<void> {
    const { signal, timeoutMs } = options;
    if (signal?.aborted === true) {
      return Promise.reject(abortError());
    }
    if (
      timeoutMs !== undefined &&
      (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    ) {
      return Promise.reject(
        new TypeError("Library lease timeoutMs must be a positive integer")
      );
    }
    if (
      this.queue.length === 0 &&
      !this.activeWriter &&
      (kind === "shared" || this.activeReaders === 0)
    ) {
      if (kind === "shared") {
        this.activeReaders += 1;
      } else {
        this.activeWriter = true;
      }
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = { kind, resolve, reject, signal };
      const rejectQueued = (error: unknown) => {
        const index = this.queue.indexOf(entry);
        if (index < 0) {
          return;
        }
        this.queue.splice(index, 1);
        if (entry.timeout !== undefined) {
          clearTimeout(entry.timeout);
        }
        signal?.removeEventListener("abort", entry.abort!);
        reject(error);
        this.drain();
      };
      if (signal !== undefined) {
        entry.abort = () => rejectQueued(abortError());
        signal.addEventListener("abort", entry.abort, { once: true });
      }
      if (timeoutMs !== undefined) {
        entry.timeout = setTimeout(
          () => rejectQueued(new LibraryBusyError(timeoutMs)),
          timeoutMs
        );
      }
      this.queue.push(entry);
      this.drain();
    });
  }

  private grant(entry: QueueEntry): void {
    if (entry.abort !== undefined) {
      entry.signal?.removeEventListener("abort", entry.abort);
    }
    if (entry.timeout !== undefined) {
      clearTimeout(entry.timeout);
    }
    if (entry.kind === "shared") {
      this.activeReaders += 1;
    } else {
      this.activeWriter = true;
    }
    entry.resolve();
  }

  private drain(): void {
    if (this.activeWriter || this.activeReaders > 0 || this.queue.length === 0) {
      return;
    }

    const first = this.queue.shift();
    if (first === undefined) {
      return;
    }
    this.grant(first);
    if (first.kind === "exclusive") {
      return;
    }

    while (this.queue[0]?.kind === "shared") {
      const reader = this.queue.shift();
      if (reader !== undefined) {
        this.grant(reader);
      }
    }
  }
}

export const libraryLeaseManager = new LibraryLeaseManager();
