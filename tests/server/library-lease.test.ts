import { describe, expect, it } from "vitest";
import {
  ActiveLibraryChangedError,
  LibraryBusyError,
  LibraryLeaseManager
} from "../../server/persistence/library-lease";
import type { LibraryIdentity } from "../../server/persistence/library-context";

function identity(path: string, vaultId: string): LibraryIdentity {
  return { path, vaultId };
}

describe("LibraryLeaseManager", () => {
  it("keeps one immutable context for the lifetime of a shared lease", async () => {
    let active = identity("C:\\vault-a", "vault-a");
    const manager = new LibraryLeaseManager(async () => active);
    const lease = await manager.acquireShared();

    active = identity("C:\\vault-b", "vault-b");

    expect(lease.context).toEqual({
      path: "C:\\vault-a",
      vaultId: "vault-a",
      generation: 0
    });
    expect(() => lease.assertCurrent()).not.toThrow();
    lease.release();
  });

  it("waits for active readers before an exclusive switch commits", async () => {
    let active = identity("C:\\vault-a", "vault-a");
    const manager = new LibraryLeaseManager(async () => active);
    const reader = await manager.acquireShared();
    let switched = false;

    const switching = manager.runExclusive(async () => {
      active = identity("C:\\vault-b", "vault-b");
      switched = true;
    });

    await Promise.resolve();
    expect(switched).toBe(false);

    reader.release();
    await switching;

    expect((await manager.currentIdentity()).generation).toBe(1);
    expect(() => reader.assertCurrent()).toThrow(ActiveLibraryChangedError);
  });

  it("does not increment generation when an exclusive switch fails", async () => {
    const manager = new LibraryLeaseManager(async () =>
      identity("C:\\vault-a", "vault-a")
    );

    await expect(
      manager.runExclusive(async () => {
        throw new Error("settings write failed");
      })
    ).rejects.toThrow("settings write failed");

    expect((await manager.currentIdentity()).generation).toBe(0);
  });

  it("prevents new readers from overtaking a waiting writer", async () => {
    let active = identity("C:\\vault-a", "vault-a");
    const manager = new LibraryLeaseManager(async () => active);
    const firstReader = await manager.acquireShared();
    const order: string[] = [];

    const writer = manager.runExclusive(async () => {
      order.push("writer");
      active = identity("C:\\vault-b", "vault-b");
    });
    const secondReader = manager.acquireShared().then((lease) => {
      order.push("reader");
      lease.release();
    });

    firstReader.release();
    await Promise.all([writer, secondReader]);

    expect(order).toEqual(["writer", "reader"]);
  });

  it("cancels a queued shared acquisition without leaking a reader", async () => {
    const manager = new LibraryLeaseManager(async () =>
      identity("C:\\vault-a", "vault-a")
    );
    const writerReached = new Promise<void>((resolve) => {
      void manager.runExclusive(async () => {
        resolve();
        await new Promise<void>((release) => setTimeout(release, 20));
      });
    });
    await writerReached;

    const controller = new AbortController();
    const acquisition = manager.acquireShared(controller.signal);
    controller.abort();

    await expect(acquisition).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns structured LIBRARY_BUSY when exclusive acquisition times out", async () => {
    const manager = new LibraryLeaseManager(async () =>
      identity("C:\\vault-a", "vault-a")
    );
    const reader = await manager.acquireShared();

    await expect(
      manager.runExclusive(async () => undefined, { timeoutMs: 10 })
    ).rejects.toBeInstanceOf(LibraryBusyError);
    await expect(
      manager.runExclusive(async () => undefined, { timeoutMs: 10 })
    ).rejects.toMatchObject({
      code: "LIBRARY_BUSY",
      status: 409
    });

    reader.release();
    await expect(
      manager.runExclusive(async () => "ready", { timeoutMs: 50 })
    ).resolves.toBe("ready");
  });
});
