export type FaultAction =
  | { kind: "throw"; error: Error }
  | { kind: "block" }
  | { kind: "callback"; run: () => Promise<void> };

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      resolvePromise?.();
    }
  };
}

export class FaultController {
  private readonly actions = new Map<string, FaultAction>();
  private readonly blocked = new Map<string, Deferred>();
  private readonly reached = new Set<string>();
  private readonly reachedWaiters = new Map<string, Deferred>();

  install(name: string, action: FaultAction): void {
    if (this.actions.has(name)) {
      throw new Error(`Fault boundary "${name}" is already configured`);
    }
    this.actions.set(name, action);
  }

  async boundary(name: string): Promise<void> {
    this.markReached(name);
    const action = this.actions.get(name);
    if (action === undefined) {
      return;
    }

    if (action.kind === "throw") {
      throw action.error;
    }
    if (action.kind === "callback") {
      await action.run();
      return;
    }

    const blocker = deferred();
    this.blocked.set(name, blocker);
    await blocker.promise;
  }

  async waitUntilReached(name: string): Promise<void> {
    if (this.reached.has(name)) {
      return;
    }
    let waiter = this.reachedWaiters.get(name);
    if (waiter === undefined) {
      waiter = deferred();
      this.reachedWaiters.set(name, waiter);
    }
    await waiter.promise;
  }

  release(name: string): void {
    const blocker = this.blocked.get(name);
    if (blocker === undefined) {
      throw new Error(`Fault boundary "${name}" is not blocked`);
    }
    this.blocked.delete(name);
    blocker.resolve();
  }

  snapshot(): string[] {
    return Array.from(this.reached);
  }

  private markReached(name: string): void {
    this.reached.add(name);
    const waiter = this.reachedWaiters.get(name);
    if (waiter !== undefined) {
      this.reachedWaiters.delete(name);
      waiter.resolve();
    }
  }
}
