import { useSyncExternalStore } from "react";

export const LIBRARY_SWITCH_DELAY_THRESHOLD_MS = 1_200;

export type LibraryMutationMetadata = Readonly<{
  id: string;
  label: string;
  startedAt: number;
  cancellable: boolean;
}>;

export type LibrarySwitchMetadata = Readonly<{
  id: string;
  label: string;
  startedAt: number;
  phase: "queued" | "waiting" | "committing" | "recovering";
  cancellable: boolean;
}>;

export type LibraryMutationState = Readonly<{
  activeMutations: number;
  activeSwitch: LibrarySwitchMetadata | null;
  delayedSwitch: LibrarySwitchMetadata | null;
  delayingMutation: LibraryMutationMetadata | null;
  pendingSwitches: number;
  switching: boolean;
}>;

export type LibraryMutationOptions = Readonly<{
  label: string;
  cancellable: boolean;
  signal?: AbortSignal;
}>;

export type LibrarySwitchOptions = Readonly<{
  label: string;
  delayThresholdMs?: number;
  signal?: AbortSignal;
}>;

export type LibrarySwitchRecoveryControl = Readonly<{
  enterRecovery: () => void;
  waitForRetry: () => Promise<void>;
}>;

export class LibrarySwitchInProgressError extends Error {
  readonly code = "LIBRARY_SWITCH_IN_PROGRESS";

  constructor() {
    super("学习库正在切换，请等待切换完成后再保存。");
    this.name = "LibrarySwitchInProgressError";
  }
}

export class LibrarySwitchCancelledError extends Error {
  readonly code = "LIBRARY_SWITCH_CANCELLED";

  constructor() {
    super("已取消学习库切换，当前学习库保持不变。");
    this.name = "LibrarySwitchCancelledError";
  }
}

export class LibraryMutationCancelledError extends Error {
  readonly code = "LIBRARY_MUTATION_CANCELLED";

  constructor(label: string) {
    super(`已取消“${label}”，学习库切换将继续。`);
    this.name = "LibraryMutationCancelledError";
  }
}

type ActiveMutationRecord = {
  controller: AbortController;
  metadata: LibraryMutationMetadata;
};

type PendingSwitchRecord = {
  controller: AbortController;
  delayed: boolean;
  metadata: {
    id: string;
    label: string;
    startedAt: number;
    phase: "queued" | "waiting" | "committing" | "recovering";
  };
  retryRecovery: (() => void) | null;
};

type IdleWaiter = {
  cleanup: () => void;
  resolve: () => void;
};

const listeners = new Set<() => void>();
const activeMutationRecords = new Map<string, ActiveMutationRecord>();
const pendingSwitchRecords = new Map<string, PendingSwitchRecord>();
let operationSequence = 0;
let switchTail: Promise<void> = Promise.resolve();
let idleWaiters: IdleWaiter[] = [];
let snapshot: LibraryMutationState = Object.freeze({
  activeMutations: 0,
  activeSwitch: null,
  delayedSwitch: null,
  delayingMutation: null,
  pendingSwitches: 0,
  switching: false
});

function nextOperationId(kind: "mutation" | "switch"): string {
  operationSequence += 1;
  return `library-${kind}-${operationSequence}`;
}

function publicSwitch(record: PendingSwitchRecord): LibrarySwitchMetadata {
  return Object.freeze({
    ...record.metadata,
    cancellable:
      record.metadata.phase === "queued" ||
      record.metadata.phase === "waiting"
  });
}

function publish(): void {
  const switches = [...pendingSwitchRecords.values()];
  const activeSwitchRecord = switches[0] ?? null;
  const delayedSwitchRecord =
    switches.find((record) => record.delayed) ?? null;
  const delayingMutationRecord =
    delayedSwitchRecord?.metadata.phase === "waiting"
      ? [...activeMutationRecords.values()][0] ?? null
      : null;

  snapshot = Object.freeze({
    activeMutations: activeMutationRecords.size,
    activeSwitch:
      activeSwitchRecord === null ? null : publicSwitch(activeSwitchRecord),
    delayedSwitch:
      delayedSwitchRecord === null ? null : publicSwitch(delayedSwitchRecord),
    delayingMutation:
      delayingMutationRecord === null
        ? null
        : Object.freeze({ ...delayingMutationRecord.metadata }),
    pendingSwitches: pendingSwitchRecords.size,
    switching: pendingSwitchRecords.size > 0
  });
  listeners.forEach((listener) => listener());
}

function signalReason(
  signal: AbortSignal,
  fallback: Error
): unknown {
  return signal.reason ?? fallback;
}

function linkSignal(
  source: AbortSignal | undefined,
  target: AbortController,
  fallback: Error
): () => void {
  if (source === undefined) {
    return () => undefined;
  }
  const abort = () => {
    if (!target.signal.aborted) {
      target.abort(signalReason(source, fallback));
    }
  };
  if (source.aborted) {
    abort();
    return () => undefined;
  }
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function abortableWait(
  promise: Promise<void>,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      () => {
        cleanup();
        resolve();
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function waitForMutationIdle(signal: AbortSignal): Promise<void> {
  if (activeMutationRecords.size === 0) {
    return Promise.resolve();
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      idleWaiters = idleWaiters.filter((candidate) => candidate !== waiter);
      waiter.cleanup();
      reject(signal.reason);
    };
    const waiter: IdleWaiter = {
      cleanup: () => signal.removeEventListener("abort", abort),
      resolve
    };
    signal.addEventListener("abort", abort, { once: true });
    idleWaiters.push(waiter);
  });
}

function finishMutation(id: string): void {
  activeMutationRecords.delete(id);
  if (activeMutationRecords.size === 0) {
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((waiter) => {
      waiter.cleanup();
      waiter.resolve();
    });
  }
  publish();
}

export async function runLibraryMutation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: LibraryMutationOptions
): Promise<T> {
  if (pendingSwitchRecords.size > 0) {
    throw new LibrarySwitchInProgressError();
  }

  const id = nextOperationId("mutation");
  const controller = new AbortController();
  const cleanupSignal = options.cancellable
    ? linkSignal(
        options.signal,
        controller,
        new LibraryMutationCancelledError(options.label)
      )
    : () => undefined;
  const record: ActiveMutationRecord = {
    controller,
    metadata: Object.freeze({
      id,
      label: options.label,
      startedAt: Date.now(),
      cancellable: options.cancellable
    })
  };
  activeMutationRecords.set(id, record);
  publish();

  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    return await operation(controller.signal);
  } finally {
    cleanupSignal();
    finishMutation(id);
  }
}

export async function runLibrarySwitch<T>(
  operation: (
    signal: AbortSignal,
    recovery: LibrarySwitchRecoveryControl
  ) => Promise<T>,
  options: LibrarySwitchOptions
): Promise<T> {
  const id = nextOperationId("switch");
  const controller = new AbortController();
  const cleanupSignal = linkSignal(
    options.signal,
    controller,
    new LibrarySwitchCancelledError()
  );
  const record: PendingSwitchRecord = {
    controller,
    delayed: false,
    metadata: {
      id,
      label: options.label,
      startedAt: Date.now(),
      phase: "queued"
    },
    retryRecovery: null
  };
  pendingSwitchRecords.set(id, record);

  const delayThresholdMs = Math.max(
    0,
    options.delayThresholdMs ?? LIBRARY_SWITCH_DELAY_THRESHOLD_MS
  );
  const delayTimer =
    delayThresholdMs === 0
      ? null
      : setTimeout(() => {
          if (pendingSwitchRecords.has(id)) {
            record.delayed = true;
            publish();
          }
        }, delayThresholdMs);
  if (delayThresholdMs === 0) {
    record.delayed = true;
  }
  publish();

  const previousSwitch = switchTail;
  let releaseTail!: () => void;
  switchTail = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });

  try {
    await abortableWait(previousSwitch, controller.signal);
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    record.metadata.phase = "waiting";
    publish();
    await waitForMutationIdle(controller.signal);
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }

    record.metadata.phase = "committing";
    cleanupSignal();
    publish();
    return await operation(controller.signal, {
      enterRecovery: () => {
        if (!pendingSwitchRecords.has(id)) {
          return;
        }
        record.delayed = true;
        record.metadata.phase = "recovering";
        publish();
      },
      waitForRetry: () => {
        if (record.metadata.phase !== "recovering") {
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          record.retryRecovery = resolve;
        });
      }
    });
  } finally {
    record.retryRecovery?.();
    record.retryRecovery = null;
    cleanupSignal();
    if (delayTimer !== null) {
      clearTimeout(delayTimer);
    }
    pendingSwitchRecords.delete(id);
    releaseTail();
    publish();
  }
}

export function cancelPendingLibrarySwitch(id: string): boolean {
  const record = pendingSwitchRecords.get(id);
  if (
    record === undefined ||
    (record.metadata.phase !== "queued" &&
      record.metadata.phase !== "waiting") ||
    record.controller.signal.aborted
  ) {
    return false;
  }
  record.controller.abort(new LibrarySwitchCancelledError());
  return true;
}

export function retryLibrarySwitchRecovery(id: string): boolean {
  const record = pendingSwitchRecords.get(id);
  const retry = record?.retryRecovery;
  if (
    record === undefined ||
    record.metadata.phase !== "recovering" ||
    retry === null ||
    retry === undefined
  ) {
    return false;
  }
  record.retryRecovery = null;
  record.metadata.phase = "committing";
  publish();
  retry();
  return true;
}

export function cancelDelayingLibraryMutation(id: string): boolean {
  const hasDelayedWaitingSwitch = [...pendingSwitchRecords.values()].some(
    (record) =>
      record.delayed && record.metadata.phase === "waiting"
  );
  if (!hasDelayedWaitingSwitch) {
    return false;
  }
  const mutation = activeMutationRecords.get(id);
  if (
    mutation === undefined ||
    !mutation.metadata.cancellable ||
    mutation.controller.signal.aborted
  ) {
    return false;
  }
  mutation.controller.abort(
    new LibraryMutationCancelledError(mutation.metadata.label)
  );
  return true;
}

export function getLibraryMutationState(): LibraryMutationState {
  return snapshot;
}

export function useLibraryMutationState(): LibraryMutationState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLibraryMutationState,
    getLibraryMutationState
  );
}
