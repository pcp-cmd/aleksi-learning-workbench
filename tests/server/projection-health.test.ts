import { mkdir, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearProjectionHealthMemoryForTests,
  readProjectionHealth,
  recordProjectionFailureHealth,
  recordProjectionSuccessHealth
} from "../../server/projections/projection-health";
import { createTempVaultContext } from "../temp-vault";

beforeEach(() => {
  clearProjectionHealthMemoryForTests();
});

describe("durable projection health", () => {
  it("records attempts and clears failure fields only after success", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    await mkdir(vaultPath, { recursive: true });

    const first = await recordProjectionFailureHealth(
      vaultPath,
      "index",
      "11111111-1111-4111-8111-111111111111",
      Object.assign(new Error("private path must not persist"), {
        code: "IO_DEADLINE_EXCEEDED"
      })
    );
    const second = await recordProjectionFailureHealth(
      vaultPath,
      "index",
      "22222222-2222-4222-8222-222222222222",
      new Error("second failure")
    );

    expect(second).toMatchObject({
      status: "stale",
      attempts: 2,
      firstFailureAt: first.firstFailureAt,
      category: "PROJECTION_REBUILD_FAILED"
    });
    expect(JSON.stringify(second)).not.toContain("private path");

    const fresh = await recordProjectionSuccessHealth(vaultPath, "index");
    expect(fresh).toMatchObject({
      status: "fresh",
      attempts: 0,
      firstFailureAt: null,
      lastFailureAt: null,
      errorId: null,
      category: null
    });
    expect(fresh.lastSuccessfulRebuildAt).not.toBeNull();
  });

  it("keeps an in-memory fallback when the health file cannot be written", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    await mkdir(`${vaultPath}/.aleksi`, { recursive: true });
    await writeFile(`${vaultPath}/.aleksi/projections`, "not a directory", "utf8");

    await recordProjectionFailureHealth(
      vaultPath,
      "index",
      "33333333-3333-4333-8333-333333333333",
      new Error("failure")
    );

    await expect(readProjectionHealth(vaultPath, "index")).resolves.toMatchObject({
      status: "stale",
      attempts: 1,
      errorId: "33333333-3333-4333-8333-333333333333"
    });
  });
});
