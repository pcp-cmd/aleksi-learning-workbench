import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelDelayingLibraryMutation,
  cancelPendingLibrarySwitch,
  getLibraryMutationState,
  runLibraryMutation,
  runLibrarySwitch
} from "../../src/lib/library-mutation-coordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function abortedOperation(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true
    });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("bounded library mutation coordination", () => {
  it("L02 waits for an active non-cancellable commit before switching", async () => {
    const commitGate = deferred<string>();
    const commit = runLibraryMutation(() => commitGate.promise, {
      label: "提交卡片",
      cancellable: false
    });
    const switchOperation = vi.fn(async () => "vault-b");
    const switching = runLibrarySwitch(switchOperation, {
      label: "更换学习库",
      delayThresholdMs: 20
    });

    expect(getLibraryMutationState()).toMatchObject({
      activeMutations: 1,
      pendingSwitches: 1,
      switching: true
    });
    expect(switchOperation).not.toHaveBeenCalled();
    expect(
      cancelDelayingLibraryMutation(
        getLibraryMutationState().delayingMutation?.id ?? "missing"
      )
    ).toBe(false);
    await expect(
      runLibraryMutation(async () => "late-save", {
        label: "迟到的保存",
        cancellable: true
      })
    ).rejects.toMatchObject({ code: "LIBRARY_SWITCH_IN_PROGRESS" });

    commitGate.resolve("saved-in-vault-a");
    await expect(commit).resolves.toBe("saved-in-vault-a");
    await expect(switching).resolves.toBe("vault-b");
    expect(switchOperation).toHaveBeenCalledTimes(1);
    expect(getLibraryMutationState()).toMatchObject({
      activeMutations: 0,
      delayedSwitch: null,
      delayingMutation: null,
      pendingSwitches: 0,
      switching: false
    });
  });

  it("L05 exposes the exact delaying operation only after the threshold", async () => {
    vi.useFakeTimers();
    const saveGate = deferred<void>();
    const save = runLibraryMutation(() => saveGate.promise, {
      label: "保存阅读《拓扑空间》",
      cancellable: false
    });
    const switching = runLibrarySwitch(async () => undefined, {
      label: "更换学习库",
      delayThresholdMs: 50
    });

    await vi.advanceTimersByTimeAsync(49);
    expect(getLibraryMutationState().delayedSwitch).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(getLibraryMutationState()).toMatchObject({
      delayedSwitch: {
        label: "更换学习库",
        phase: "waiting"
      },
      delayingMutation: {
        label: "保存阅读《拓扑空间》",
        cancellable: false
      }
    });

    saveGate.resolve();
    await Promise.all([save, switching]);
    vi.useRealTimers();
  });

  it("L06 cancels a pending switch without interrupting the active commit", async () => {
    vi.useFakeTimers();
    const commitGate = deferred<void>();
    const commit = runLibraryMutation(() => commitGate.promise, {
      label: "提交复习证据",
      cancellable: false
    });
    const switchOperation = vi.fn(async () => undefined);
    const switching = runLibrarySwitch(switchOperation, {
      label: "迁移学习库",
      delayThresholdMs: 10
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(
      cancelPendingLibrarySwitch(
        getLibraryMutationState().delayedSwitch?.id ?? "missing"
      )
    ).toBe(true);
    await expect(switching).rejects.toMatchObject({
      code: "LIBRARY_SWITCH_CANCELLED"
    });
    expect(switchOperation).not.toHaveBeenCalled();
    expect(getLibraryMutationState().activeMutations).toBe(1);

    commitGate.resolve();
    await commit;
    vi.useRealTimers();
  });

  it("cancels a safe stuck save and lets the pending switch continue", async () => {
    vi.useFakeTimers();
    const save = runLibraryMutation(abortedOperation, {
      label: "保存卡片“积分”",
      cancellable: true
    });
    const switchOperation = vi.fn(async () => "vault-b");
    const switching = runLibrarySwitch(switchOperation, {
      label: "更换学习库",
      delayThresholdMs: 10
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(
      cancelDelayingLibraryMutation(
        getLibraryMutationState().delayingMutation?.id ?? "missing"
      )
    ).toBe(true);
    await expect(save).rejects.toMatchObject({
      code: "LIBRARY_MUTATION_CANCELLED"
    });
    await expect(switching).resolves.toBe("vault-b");
    expect(switchOperation).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("never exposes cancellation after a switch enters its commit section", async () => {
    const switchGate = deferred<void>();
    const commitSignalGate = deferred<AbortSignal>();
    const caller = new AbortController();
    const switching = runLibrarySwitch(
      async (signal) => {
        commitSignalGate.resolve(signal);
        await switchGate.promise;
        return signal.aborted;
      },
      {
        label: "选择新学习库",
        delayThresholdMs: 0,
        signal: caller.signal
      }
    );

    await vi.waitFor(() =>
      expect(getLibraryMutationState().activeSwitch?.phase).toBe("committing")
    );
    caller.abort();
    expect(
      cancelPendingLibrarySwitch(
        getLibraryMutationState().delayedSwitch?.id ?? "missing"
      )
    ).toBe(false);
    await expect(commitSignalGate.promise).resolves.toMatchObject({
      aborted: false
    });

    switchGate.resolve();
    await expect(switching).resolves.toBe(false);
  });

  it("serializes two switch requests without allowing a save between them", async () => {
    const firstGate = deferred<void>();
    const order: string[] = [];
    const first = runLibrarySwitch(
      async () => {
        order.push("first-start");
        await firstGate.promise;
        order.push("first-end");
      },
      { label: "第一次切换" }
    );
    const second = runLibrarySwitch(
      async () => {
        order.push("second");
      },
      { label: "第二次切换" }
    );

    await vi.waitFor(() => {
      expect(order).toEqual(["first-start"]);
    });
    await expect(
      runLibraryMutation(async () => undefined, {
        label: "切换间保存",
        cancellable: true
      })
    ).rejects.toMatchObject({ code: "LIBRARY_SWITCH_IN_PROGRESS" });
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("does not let a stale switch button cancel the next queued switch", async () => {
    const saveGate = deferred<void>();
    const save = runLibraryMutation(() => saveGate.promise, {
      label: "保存旧学习库内容",
      cancellable: false
    });
    const firstOperation = vi.fn(async () => undefined);
    const secondOperation = vi.fn(async () => undefined);
    const first = runLibrarySwitch(firstOperation, {
      label: "第一次切换",
      delayThresholdMs: 0
    });
    const second = runLibrarySwitch(secondOperation, {
      label: "第二次切换",
      delayThresholdMs: 0
    });
    const staleId = getLibraryMutationState().delayedSwitch?.id ?? "missing";

    expect(cancelPendingLibrarySwitch(staleId)).toBe(true);
    await expect(first).rejects.toMatchObject({
      code: "LIBRARY_SWITCH_CANCELLED"
    });
    await vi.waitFor(() =>
      expect(getLibraryMutationState().activeSwitch?.label).toBe("第二次切换")
    );
    expect(cancelPendingLibrarySwitch(staleId)).toBe(false);
    expect(secondOperation).not.toHaveBeenCalled();

    saveGate.resolve();
    await save;
    await expect(second).resolves.toBeUndefined();
    expect(secondOperation).toHaveBeenCalledOnce();
  });

  it("does not let a stale save button cancel a different active mutation", async () => {
    const firstSave = runLibraryMutation(abortedOperation, {
      label: "第一个可取消保存",
      cancellable: true
    });
    const secondSave = runLibraryMutation(abortedOperation, {
      label: "第二个可取消保存",
      cancellable: true
    });
    const switching = runLibrarySwitch(async () => "vault-b", {
      label: "更换学习库",
      delayThresholdMs: 0
    });
    await vi.waitFor(() =>
      expect(getLibraryMutationState().activeSwitch?.phase).toBe("waiting")
    );
    const staleId =
      getLibraryMutationState().delayingMutation?.id ?? "missing";

    expect(cancelDelayingLibraryMutation(staleId)).toBe(true);
    await expect(firstSave).rejects.toMatchObject({
      code: "LIBRARY_MUTATION_CANCELLED"
    });
    await vi.waitFor(() =>
      expect(getLibraryMutationState().delayingMutation?.label).toBe(
        "第二个可取消保存"
      )
    );
    expect(cancelDelayingLibraryMutation(staleId)).toBe(false);
    const secondId =
      getLibraryMutationState().delayingMutation?.id ?? "missing";
    expect(cancelDelayingLibraryMutation(secondId)).toBe(true);

    await expect(secondSave).rejects.toMatchObject({
      code: "LIBRARY_MUTATION_CANCELLED"
    });
    await expect(switching).resolves.toBe("vault-b");
  });
});
