import { useSyncExternalStore } from "react";

export type LibraryMutationState = Readonly<{
  activeMutations: number;
  pendingSwitches: number;
  switching: boolean;
}>;

export class LibrarySwitchInProgressError extends Error {
  readonly code = "LIBRARY_SWITCH_IN_PROGRESS";

  constructor() {
    super("学习库正在切换，请等待切换完成后再保存。");
    this.name = "LibrarySwitchInProgressError";
  }
}

const listeners = new Set<() => void>();
let activeMutations = 0;
let pendingSwitches = 0;
let switchTail: Promise<void> = Promise.resolve();
let idleWaiters: Array<() => void> = [];
let snapshot: LibraryMutationState = Object.freeze({
  activeMutations: 0,
  pendingSwitches: 0,
  switching: false
});

function publish(): void {
  snapshot = Object.freeze({
    activeMutations,
    pendingSwitches,
    switching: pendingSwitches > 0
  });
  listeners.forEach((listener) => listener());
}

function waitForMutationIdle(): Promise<void> {
  if (activeMutations === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

function finishMutation(): void {
  activeMutations -= 1;
  if (activeMutations === 0) {
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
  publish();
}

export async function runLibraryMutation<T>(
  operation: () => Promise<T>
): Promise<T> {
  if (pendingSwitches > 0) throw new LibrarySwitchInProgressError();
  activeMutations += 1;
  publish();
  try {
    return await operation();
  } finally {
    finishMutation();
  }
}

export async function runLibrarySwitch<T>(
  operation: () => Promise<T>
): Promise<T> {
  pendingSwitches += 1;
  publish();
  const previousSwitch = switchTail;
  let releaseTail!: () => void;
  switchTail = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });
  try {
    await previousSwitch.catch(() => undefined);
    await waitForMutationIdle();
    return await operation();
  } finally {
    pendingSwitches -= 1;
    releaseTail();
    publish();
  }
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
