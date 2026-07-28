import { readFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { LibraryLeaseManager } from "../../server/persistence/library-lease";
import { activeLearningLibraryIdentity } from "../../server/persistence/library-context";
import { createTempVaultContext } from "../temp-vault";

async function vaultId(path: string): Promise<string> {
  const raw = await readFile(join(path, ".aleksi", "settings.json"), "utf8");
  return String((JSON.parse(raw) as { vaultId: unknown }).vaultId);
}

describe("request-level LibraryContext", () => {
  it("returns immutable vault identity headers for each library request", async () => {
    const context = await createTempVaultContext();
    const leases = new LibraryLeaseManager(activeLearningLibraryIdentity);
    const app = createApp({ libraryLeases: leases });
    const firstPath = context.path("vault-a");
    const secondPath = context.path("vault-b");

    expect(
      (await request(app).post("/api/vault/initialize").send({ path: firstPath }))
        .status
    ).toBe(200);
    const first = await request(app).get("/api/cards/recent?limit=10");

    expect(first.status).toBe(200);
    expect(first.headers["x-aleksi-vault-id"]).toBe(await vaultId(firstPath));
    expect(first.headers["x-aleksi-vault-generation"]).toBe("1");

    expect(
      (
        await request(app)
          .post("/api/vault/initialize")
          .send({ path: secondPath })
      ).status
    ).toBe(200);
    const second = await request(app).get("/api/cards/recent?limit=10");

    expect(second.status).toBe(200);
    expect(second.headers["x-aleksi-vault-id"]).toBe(await vaultId(secondPath));
    expect(second.headers["x-aleksi-vault-generation"]).toBe("2");
    expect(second.headers["x-aleksi-vault-id"]).not.toBe(
      first.headers["x-aleksi-vault-id"]
    );
  });

  it("makes a vault switch wait for an in-flight library request lease", async () => {
    const context = await createTempVaultContext();
    const leases = new LibraryLeaseManager(activeLearningLibraryIdentity);
    const app = createApp({ libraryLeases: leases });
    const firstPath = context.path("vault-a");
    const secondPath = context.path("vault-b");

    await request(app).post("/api/vault/initialize").send({ path: firstPath });
    await request(app).post("/api/vault/initialize").send({ path: secondPath });
    await request(app).post("/api/vault/select").send({ path: firstPath });
    const inFlight = await leases.acquireShared();
    let completed = false;

    const switching = request(app)
      .post("/api/vault/select")
      .send({ path: secondPath })
      .then((response) => {
        completed = true;
        return response;
      });

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(completed).toBe(false);
    expect(inFlight.context.path).toBe(firstPath);

    inFlight.release();
    const response = await switching;

    expect(response.status).toBe(200);
    expect((await leases.currentIdentity()).path).toBe(secondPath);
  });

  it("binds each concurrent switch body to the identity headers captured in the same exclusive lease", async () => {
    const context = await createTempVaultContext();
    const leases = new LibraryLeaseManager(activeLearningLibraryIdentity);
    const app = createApp({ libraryLeases: leases });
    const firstPath = context.path("vault-a");
    const secondPath = context.path("vault-b");

    await request(app).post("/api/vault/initialize").send({ path: firstPath });
    await request(app).post("/api/vault/initialize").send({ path: secondPath });

    const [first, second] = await Promise.all([
      request(app).post("/api/vault/select").send({ path: firstPath }),
      request(app).post("/api/vault/select").send({ path: secondPath })
    ]);

    for (const response of [first, second]) {
      expect(response.status).toBe(200);
      const returnedPath = String(response.body.status.path);
      expect(response.headers["x-aleksi-vault-id"]).toBe(
        await vaultId(returnedPath)
      );
      expect(Number(response.headers["x-aleksi-vault-generation"])).toBeGreaterThan(
        0
      );
    }
    expect(first.body.status.path).toBe(firstPath);
    expect(second.body.status.path).toBe(secondPath);
    expect(first.headers["x-aleksi-vault-generation"]).not.toBe(
      second.headers["x-aleksi-vault-generation"]
    );
  });
});
