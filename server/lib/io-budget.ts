export type IoBudgetLimits = {
  maxDepth: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxConcurrency: number;
  deadlineAt: number;
};

export type IoBudgetSnapshot = Readonly<{
  files: number;
  bytes: number;
}>;

export class IoBudgetError extends Error {
  readonly status: number;

  constructor(
    readonly code:
      | "IO_ABORTED"
      | "IO_DEADLINE_EXCEEDED"
      | "IO_DEPTH_LIMIT"
      | "IO_FILE_COUNT_LIMIT"
      | "IO_FILE_SIZE_LIMIT"
      | "IO_TOTAL_BYTES_LIMIT",
    message: string,
    status = 422
  ) {
    super(message);
    this.name = "IoBudgetError";
    this.status = status;
  }
}

export class IoBudget {
  readonly limits: Readonly<IoBudgetLimits>;
  #files = 0;
  #bytes = 0;

  constructor(limits: IoBudgetLimits) {
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be a finite non-negative number`);
      }
    }
    if (!Number.isInteger(limits.maxConcurrency) || limits.maxConcurrency < 1) {
      throw new RangeError("maxConcurrency must be a positive integer");
    }
    this.limits = Object.freeze({ ...limits });
  }

  checkpoint(signal?: AbortSignal): void {
    if (signal?.aborted === true) {
      throw new IoBudgetError("IO_ABORTED", "I/O operation was cancelled", 499);
    }
    if (Date.now() > this.limits.deadlineAt) {
      throw new IoBudgetError(
        "IO_DEADLINE_EXCEEDED",
        "I/O operation exceeded its deadline",
        503
      );
    }
  }

  claimFile(size: number, depth: number, signal?: AbortSignal): void {
    this.checkpoint(signal);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new RangeError("File size must be a non-negative safe integer");
    }
    if (!Number.isInteger(depth) || depth < 0) {
      throw new RangeError("File depth must be a non-negative integer");
    }
    if (depth > this.limits.maxDepth) {
      throw new IoBudgetError(
        "IO_DEPTH_LIMIT",
        `I/O directory depth exceeds ${this.limits.maxDepth}`
      );
    }
    if (size > this.limits.maxFileBytes) {
      throw new IoBudgetError(
        "IO_FILE_SIZE_LIMIT",
        `I/O file size exceeds ${this.limits.maxFileBytes} bytes`
      );
    }
    const nextFiles = this.#files + 1;
    const nextBytes = this.#bytes + size;
    if (nextFiles > this.limits.maxFiles) {
      throw new IoBudgetError(
        "IO_FILE_COUNT_LIMIT",
        `I/O file count exceeds ${this.limits.maxFiles}`
      );
    }
    if (nextBytes > this.limits.maxTotalBytes) {
      throw new IoBudgetError(
        "IO_TOTAL_BYTES_LIMIT",
        `I/O total bytes exceed ${this.limits.maxTotalBytes}`
      );
    }
    this.#files = nextFiles;
    this.#bytes = nextBytes;
  }

  snapshot(): IoBudgetSnapshot {
    return Object.freeze({
      files: this.#files,
      bytes: this.#bytes
    });
  }
}
