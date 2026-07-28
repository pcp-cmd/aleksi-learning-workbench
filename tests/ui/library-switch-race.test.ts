import { describe, expect, it, vi } from "vitest";
import {
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

describe("library mutation coordination", () => {
  it("waits for an active save, blocks later mutations, then switches", async () => {
    const saveGate = deferred<string>();
    const save = runLibraryMutation(() => saveGate.promise);
    const switchOperation = vi.fn(async () => "vault-b");
    const switching = runLibrarySwitch(switchOperation);

    expect(getLibraryMutationState()).toMatchObject({
      activeMutations: 1,
      pendingSwitches: 1,
      switching: true
    });
    expect(switchOperation).not.toHaveBeenCalled();
    await expect(
      runLibraryMutation(async () => "late-save")
    ).rejects.toMatchObject({ code: "LIBRARY_SWITCH_IN_PROGRESS" });

    saveGate.resolve("saved-in-vault-a");
    await expect(save).resolves.toBe("saved-in-vault-a");
    await expect(switching).resolves.toBe("vault-b");
    expect(switchOperation).toHaveBeenCalledTimes(1);
    expect(getLibraryMutationState()).toEqual({
      activeMutations: 0,
      pendingSwitches: 0,
      switching: false
    });
  });

  it("serializes two switch requests without allowing a save between them", async () => {
    const firstGate = deferred<void>();
    const order: string[] = [];
    const first = runLibrarySwitch(async () => {
      order.push("first-start");
      await firstGate.promise;
      order.push("first-end");
    });
    const second = runLibrarySwitch(async () => {
      order.push("second");
    });

    await vi.waitFor(() => {
      expect(order).toEqual(["first-start"]);
    });
    await expect(
      runLibraryMutation(async () => undefined)
    ).rejects.toMatchObject({ code: "LIBRARY_SWITCH_IN_PROGRESS" });
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
