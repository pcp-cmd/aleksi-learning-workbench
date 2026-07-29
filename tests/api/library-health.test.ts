import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { readVaultId } from "../../server/services/vault-service";
import { FaultController } from "../../server/testing/fault-controller";
import {
  runFileTransaction,
  TransactionQuarantinedError
} from "../../server/transactions/transaction-runner";
import { createTempVaultContext, type TempVaultContext } from "../temp-vault";

let context: TempVaultContext;
let vaultPath: string;
let vaultId: string;

async function quarantineExternalEdit(
  targetName = "card.md"
): Promise<{ transactionId: string; targetPath: string }> {
  const targetPath = join(vaultPath, targetName);
  await writeFile(targetPath, "old", "utf8");
  const faults = new FaultController();
  faults.install("transaction:before-target:0", {
    kind: "callback",
    run: async () => writeFile(targetPath, "external", "utf8")
  });

  let transactionId = "";
  try {
    await runFileTransaction({
      operation: "health-resolution-test",
      targets: [{ relativePath: targetName, content: "intended" }],
      vaultId,
      vaultPath,
      faults
    });
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionQuarantinedError);
    transactionId = (error as TransactionQuarantinedError).transactionId;
  }
  expect(transactionId).not.toBe("");
  return { transactionId, targetPath };
}

beforeEach(async () => {
  context = await createTempVaultContext();
  vaultPath = context.path("Vault");
  const initialized = await request(createApp())
    .post("/api/vault/initialize")
    .send({ path: vaultPath });
  expect(initialized.status).toBe(200);
  vaultId = await readVaultId(vaultPath);
});

describe("learning-library transaction health API", () => {
  it("makes unreadable primary and mirror journals visible without leaking absolute paths", async () => {
    const transactionId = "11111111-1111-4111-8111-111111111111";
    const directory = join(vaultPath, ".aleksi", "transactions");
    await mkdir(join(directory, transactionId), { recursive: true });
    await writeFile(join(directory, `${transactionId}.json`), "{broken", "utf8");
    await writeFile(
      join(directory, `${transactionId}.mirror`),
      "also broken",
      "utf8"
    );

    const response = await request(createApp()).get("/api/vault/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      blocked: true,
      transactions: [
        expect.objectContaining({
          transactionId,
          operation: "unknown",
          state: "unreadable",
          targets: [],
          allowedActions: [
            "export_recovery_bundle",
            "remove_unreadable_journal"
          ]
        })
      ]
    });
    expect(JSON.stringify(response.body)).not.toContain(vaultPath);
  });

  it("accepts the current external version, preserves it, and unlocks later writes", async () => {
    const app = createApp();
    const { transactionId, targetPath } = await quarantineExternalEdit();

    const blocked = await request(app)
      .post("/api/readings")
      .send({
        title: "Blocked while recovery is unresolved",
        concept: "Transaction safety",
        body: "This write must remain blocked.",
        source: "manual-paste"
      });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({
      code: "TRANSACTION_QUARANTINED",
      transactionId
    });

    const resolved = await request(app)
      .post(`/api/vault/health/transactions/${transactionId}/actions`)
      .send({ action: "accept_current_external_version" });

    expect(resolved.status).toBe(200);
    const replay = await request(app)
      .post(`/api/vault/health/transactions/${transactionId}/actions`)
      .send({ action: "accept_current_external_version" });
    expect(replay.status).toBe(200);
    await expect(readFile(targetPath, "utf8")).resolves.toBe("external");
    const health = await request(app).get("/api/vault/health");
    expect(health.body.blocked).toBe(false);

    await expect(
      runFileTransaction({
        operation: "write-after-resolution",
        targets: [{ relativePath: "after.md", content: "ok" }],
        vaultId,
        vaultPath
      })
    ).resolves.toEqual({ transactionId: expect.any(String) });
  });

  it("requires an apply-intended preview and rejects a stale current-file CAS", async () => {
    const app = createApp();
    const { transactionId, targetPath } = await quarantineExternalEdit();

    const missingPreview = await request(app)
      .post(`/api/vault/health/transactions/${transactionId}/actions`)
      .send({ action: "apply_intended_version" });
    expect(missingPreview.status).toBe(422);

    const preview = await request(app)
      .post(`/api/vault/health/transactions/${transactionId}/preview`)
      .send({ action: "apply_intended_version" });
    expect(preview.status).toBe(200);
    expect(preview.body.previewToken).toEqual(expect.any(String));
    expect(JSON.stringify(preview.body)).not.toContain(vaultPath);

    await writeFile(targetPath, "changed-after-preview", "utf8");
    const stale = await request(app)
      .post(`/api/vault/health/transactions/${transactionId}/actions`)
      .send({
        action: "apply_intended_version",
        previewToken: preview.body.previewToken
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("TRANSACTION_RECOVERY_CAS_MISMATCH");
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "changed-after-preview"
    );

    const freshPreview = await request(app)
      .post(`/api/vault/health/transactions/${transactionId}/preview`)
      .send({ action: "apply_intended_version" });
    const applied = await request(app)
      .post(`/api/vault/health/transactions/${transactionId}/actions`)
      .send({
        action: "apply_intended_version",
        previewToken: freshPreview.body.previewToken
      });
    expect(applied.status).toBe(200);
    await expect(readFile(targetPath, "utf8")).resolves.toBe("intended");
  });

  it("retries a quarantined recovery after the external conflict is removed", async () => {
    const app = createApp();
    const { transactionId, targetPath } = await quarantineExternalEdit(
      "retry.md"
    );
    await writeFile(targetPath, "old", "utf8");

    const retried = await request(app)
      .post(`/api/vault/health/transactions/${transactionId}/actions`)
      .send({ action: "retry_recovery" });

    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({
      action: "retry_recovery",
      blocked: false
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe("intended");
  });

  it("exports relative-only recovery metadata and archives unreadable evidence before unlocking", async () => {
    const transactionId = "22222222-2222-4222-8222-222222222222";
    const directory = join(vaultPath, ".aleksi", "transactions");
    await mkdir(join(directory, transactionId), { recursive: true });
    await writeFile(join(directory, `${transactionId}.json`), "bad", "utf8");
    await writeFile(join(directory, `${transactionId}.mirror`), "bad", "utf8");

    const app = createApp();
    const exported = await request(app)
      .post(`/api/vault/health/transactions/${transactionId}/actions`)
      .send({ action: "export_recovery_bundle" });
    expect(exported.status).toBe(200);
    expect(exported.body.bundle.transactionId).toBe(transactionId);
    expect(JSON.stringify(exported.body)).not.toContain(vaultPath);

    const removed = await request(app)
      .post(`/api/vault/health/transactions/${transactionId}/actions`)
      .send({ action: "remove_unreadable_journal" });
    expect(removed.status).toBe(200);
    expect(removed.body.blocked).toBe(false);
    expect(await readdir(directory)).toEqual([]);

    const quarantineRoot = join(
      vaultPath,
      ".aleksi",
      "quarantine",
      "transactions"
    );
    expect((await readdir(quarantineRoot)).length).toBeGreaterThan(0);
  });
});
