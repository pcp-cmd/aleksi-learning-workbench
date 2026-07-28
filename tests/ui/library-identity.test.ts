import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../src/lib/api-client";
import {
  getLibraryIdentity,
  libraryQueryScope,
  resetLibraryIdentity,
  setLibraryIdentity
} from "../../src/lib/library-identity";

function response(
  payload: unknown,
  vaultId: string,
  generation: number,
  instanceId = "instance-a"
): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Aleksi-Library-Instance": instanceId,
      "X-Aleksi-Vault-Id": vaultId,
      "X-Aleksi-Vault-Generation": String(generation)
    }
  });
}

describe("client library identity", () => {
  beforeEach(() => {
    resetLibraryIdentity();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    resetLibraryIdentity();
  });

  it("advances monotonically and refuses a stale or conflicting identity", () => {
    expect(
      setLibraryIdentity({ instanceId: "instance-a", vaultId: "vault-a", generation: 1 })
    ).toBe("accepted");
    expect(
      setLibraryIdentity({ instanceId: "instance-a", vaultId: "vault-b", generation: 2 })
    ).toBe("accepted");
    expect(
      setLibraryIdentity({ instanceId: "instance-a", vaultId: "vault-a", generation: 1 })
    ).toBe("stale");
    expect(
      setLibraryIdentity({ instanceId: "instance-a", vaultId: "vault-c", generation: 2 })
    ).toBe("stale");
    expect(getLibraryIdentity()).toEqual({
      instanceId: "instance-a",
      vaultId: "vault-b",
      generation: 2
    });
  });

  it("includes vault ID and generation in library query scope", () => {
    expect(libraryQueryScope(null)).toEqual(["unconfigured", "unconfigured", -1]);
    expect(
      libraryQueryScope({ instanceId: "instance-a", vaultId: "vault-a", generation: 7 })
    ).toEqual(["instance-a", "vault-a", 7]);
  });

  it("drops a slow old-vault response after a newer generation is observed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ value: "new" }, "vault-b", 2))
      .mockResolvedValueOnce(response({ value: "old" }, "vault-a", 1));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.get("/api/new")).resolves.toEqual({ value: "new" });
    await expect(apiClient.get("/api/old")).rejects.toMatchObject({
      code: "ACTIVE_LIBRARY_CHANGED",
      status: 409
    });
    expect(getLibraryIdentity()).toEqual({
      instanceId: "instance-a",
      vaultId: "vault-b",
      generation: 2
    });
  });

  it("accepts a lower generation from a new sidecar instance and rejects retired responses", () => {
    expect(
      setLibraryIdentity({ instanceId: "instance-a", vaultId: "vault-a", generation: 8 })
    ).toBe("accepted");
    expect(
      setLibraryIdentity({ instanceId: "instance-b", vaultId: "vault-a", generation: 0 })
    ).toBe("accepted");
    expect(
      setLibraryIdentity({ instanceId: "instance-a", vaultId: "vault-a", generation: 9 })
    ).toBe("stale");
    expect(getLibraryIdentity()).toEqual({
      instanceId: "instance-b",
      vaultId: "vault-a",
      generation: 0
    });
  });
});
