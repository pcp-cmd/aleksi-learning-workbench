import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import {
  libraryRequestMiddleware,
  withLibraryOperation
} from "../../server/http/library-request";
import { LibraryLeaseManager } from "../../server/persistence/library-lease";
import type { LibraryIdentity } from "../../server/persistence/library-context";

type MockResponse = EventEmitter & {
  destroyed: boolean;
  locals: Record<string, unknown>;
  set(name: string, value: string): void;
  writableEnded: boolean;
};

function identity(path: string, vaultId: string): LibraryIdentity {
  return { path, vaultId };
}

async function requestScope(manager: LibraryLeaseManager) {
  const request = new EventEmitter();
  const headers = new Map<string, string>();
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    locals: {},
    set(name: string, value: string) {
      headers.set(name, value);
    },
    writableEnded: false
  }) as MockResponse;
  await new Promise<void>((resolve, reject) => {
    libraryRequestMiddleware(manager)(
      request as unknown as Request,
      response as unknown as Response,
      (error?: unknown) => (error === undefined ? resolve() : reject(error))
    );
  });
  return { headers, request, response };
}

describe("handler-owned LibraryOperationContext", () => {
  it("keeps a disconnected non-cancellable operation leased until its promise settles", async () => {
    let active = identity("C:\\vault-a", "vault-a");
    const manager = new LibraryLeaseManager(async () => active);
    const scope = await requestScope(manager);
    let finish!: () => void;
    let entered!: () => void;
    const operationEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const operation = withLibraryOperation(
      scope.request as unknown as Request,
      scope.response as unknown as Response,
      async (context) => {
        expect(Object.isFrozen(context)).toBe(true);
        expect(context.vaultId).toBe("vault-a");
        expect(context.generation).toBe(0);
        expect(scope.headers.get("X-Aleksi-Vault-Id")).toBe("vault-a");
        entered();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        context.assertCurrent();
        return "committed";
      }
    );
    await operationEntered;

    scope.response.emit("close");
    let switched = false;
    const switching = manager.runExclusive(async () => {
      active = identity("C:\\vault-b", "vault-b");
      switched = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(switched).toBe(false);

    finish();
    await expect(operation).resolves.toBe("committed");
    await switching;
    expect(switched).toBe(true);
  });

  it("aborts cancellable work on disconnect and releases after rejection", async () => {
    const manager = new LibraryLeaseManager(async () =>
      identity("C:\\vault-a", "vault-a")
    );
    const scope = await requestScope(manager);
    let entered!: () => void;
    const operationEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const operation = withLibraryOperation(
      scope.request as unknown as Request,
      scope.response as unknown as Response,
      async (context) =>
        new Promise<never>((_resolve, reject) => {
          entered();
          context.signal.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("The operation was aborted", "AbortError")
              ),
            { once: true }
          );
        })
    );
    await operationEntered;

    scope.response.emit("close");
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      manager.runExclusive(async () => "switched", { timeoutMs: 50 })
    ).resolves.toBe("switched");
  });
});
