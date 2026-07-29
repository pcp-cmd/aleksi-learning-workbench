import {
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { FaultController } from "../../server/testing/fault-controller";
import {
  runFileTransaction,
  TransactionQuarantinedError
} from "../../server/transactions/transaction-runner";
import { recoverTransactions } from "../../server/transactions/transaction-recovery";
import { readAssetVersion } from "../../server/lib/asset-version";
import {
  loadJournal,
  writeTransactionPayload
} from "../../server/transactions/transaction-journal";
import { inspectTransactionHealth } from "../../server/transactions/transaction-health";
import request from "supertest";
import { createApp } from "../../server/app";
import { readVaultId } from "../../server/services/vault-service";
import { createTempVaultContext } from "../temp-vault";

const roots: string[] = [];

async function vault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aleksi-transaction-"));
  roots.push(root);
  await mkdir(join(root, ".aleksi"), { recursive: true });
  return root;
}

async function journalNames(root: string): Promise<string[]> {
  const directory = join(root, ".aleksi", "transactions");
  try {
    return (await readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("crash-recoverable file transactions", () => {
  it("rejects a transaction directory junction that leaves the vault", async ({
    skip
  }) => {
    const root = await vault();
    const outside = await mkdtemp(join(tmpdir(), "aleksi-transaction-outside-"));
    roots.push(outside);
    const transactionDirectory = join(root, ".aleksi", "transactions");
    try {
      await symlink(
        outside,
        transactionDirectory,
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))
      ) {
        skip(`OS denied directory link creation: ${String(error.code)}`);
        return;
      }
      throw error;
    }
    await writeFile(join(root, "card.md"), "old", "utf8");

    await expect(
      runFileTransaction({
        operation: "card-update",
        targets: [{ relativePath: "card.md", content: "new" }],
        vaultId: "vault-a",
        vaultPath: root
      })
    ).rejects.toMatchObject({
      code: "SYMLINK_OUTSIDE_VAULT"
    });
    await expect(readdir(outside)).resolves.toEqual([]);
    await expect(readFile(join(root, "card.md"), "utf8")).resolves.toBe("old");
  });

  it("recovers a prepared transaction and remains idempotent", async () => {
    const root = await vault();
    const target = join(root, "card.md");
    await writeFile(target, "old", "utf8");
    const faults = new FaultController();
    faults.install("transaction:after-prepare", {
      kind: "throw",
      error: new Error("simulated termination")
    });

    await expect(
      runFileTransaction({
        operation: "card-update",
        targets: [{ relativePath: "card.md", content: "new" }],
        vaultId: "vault-a",
        vaultPath: root,
        faults
      })
    ).rejects.toThrow("simulated termination");

    await expect(readFile(target, "utf8")).resolves.toBe("old");
    expect(await journalNames(root)).toHaveLength(1);

    await expect(recoverTransactions(root, "vault-a")).resolves.toMatchObject({
      committed: 1,
      quarantined: 0
    });
    await expect(readFile(target, "utf8")).resolves.toBe("new");
    expect(await journalNames(root)).toEqual([]);

    await expect(recoverTransactions(root, "vault-a")).resolves.toEqual({
      committed: 0,
      quarantined: 0,
      diagnostics: []
    });
  });

  it("finishes a transaction whose new bytes were applied before termination", async () => {
    const root = await vault();
    const target = join(root, "card.md");
    await writeFile(target, "old", "utf8");
    const faults = new FaultController();
    faults.install("transaction:after-target:0", {
      kind: "throw",
      error: new Error("terminated after rename")
    });

    await expect(
      runFileTransaction({
        operation: "card-update",
        targets: [{ relativePath: "card.md", content: "new" }],
        vaultId: "vault-a",
        vaultPath: root,
        faults
      })
    ).rejects.toThrow("terminated after rename");
    await expect(readFile(target, "utf8")).resolves.toBe("new");

    await recoverTransactions(root, "vault-a");

    await expect(readFile(target, "utf8")).resolves.toBe("new");
    expect(await journalNames(root)).toEqual([]);
  });

  it("recovers when Windows replacement removed the live target before termination", async () => {
    const root = await vault();
    const target = join(root, "card.md");
    await writeFile(target, "old", "utf8");
    const faults = new FaultController();
    faults.install("transaction:after-prepare", {
      kind: "throw",
      error: new Error("terminated before replacement")
    });

    await expect(
      runFileTransaction({
        operation: "card-update",
        targets: [{ relativePath: "card.md", content: "new" }],
        vaultId: "vault-a",
        vaultPath: root,
        faults
      })
    ).rejects.toThrow("terminated before replacement");
    const [journalName] = await journalNames(root);
    const transactionId = journalName!.replace(/\.json$/u, "");
    const journal = await loadJournal(root, transactionId);
    const displacedPath = journal.targets[0]!.displacedPath!;
    await writeTransactionPayload(root, displacedPath, "old");
    await rm(target);

    await expect(recoverTransactions(root, "vault-a")).resolves.toMatchObject({
      committed: 1,
      quarantined: 0
    });
    await expect(readFile(target, "utf8")).resolves.toBe("new");
    expect(await journalNames(root)).toEqual([]);
  });

  it("never overwrites an external edit and quarantines the transaction", async () => {
    const root = await vault();
    const target = join(root, "card.md");
    await writeFile(target, "old", "utf8");
    const faults = new FaultController();
    faults.install("transaction:before-target:0", {
      kind: "callback",
      run: async () => writeFile(target, "external", "utf8")
    });

    await expect(
      runFileTransaction({
        operation: "card-update",
        targets: [{ relativePath: "card.md", content: "new" }],
        vaultId: "vault-a",
        vaultPath: root,
        faults
      })
    ).rejects.toBeInstanceOf(TransactionQuarantinedError);

    await expect(readFile(target, "utf8")).resolves.toBe("external");
    const [journalName] = await journalNames(root);
    const journal = JSON.parse(
      await readFile(join(root, ".aleksi", "transactions", journalName!), "utf8")
    ) as { state: string };
    expect(journal.state).toBe("quarantined");
  });

  it("rejects a stale expected version before preparing a journal", async () => {
    const root = await vault();
    const target = join(root, "card.md");
    await writeFile(target, "old", "utf8");
    const expectedVersion = await readAssetVersion(target);
    await writeFile(target, "external", "utf8");

    await expect(
      runFileTransaction({
        operation: "card-update",
        targets: [
          {
            relativePath: "card.md",
            content: "new",
            expectedVersion
          }
        ],
        vaultId: "vault-a",
        vaultPath: root
      })
    ).rejects.toMatchObject({
      code: "ASSET_VERSION_CONFLICT",
      status: 409
    });

    await expect(readFile(target, "utf8")).resolves.toBe("external");
    expect(await journalNames(root)).toEqual([]);
  });

  it("rejects duplicate normalized targets before creating transaction state", async () => {
    const root = await vault();

    await expect(
      runFileTransaction({
        operation: "duplicate-target-test",
        targets: [
          { relativePath: "café.md", content: "first" },
          { relativePath: "cafe\u0301.md", content: "second" }
        ],
        vaultId: "vault-a",
        vaultPath: root
      })
    ).rejects.toMatchObject({
      code: "DUPLICATE_TRANSACTION_TARGET",
      status: 422
    });

    await expect(
      readdir(join(root, ".aleksi", "transactions"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("discovers and safely quarantines a payload orphan left before journal persistence", async () => {
    const root = await vault();
    await writeFile(join(root, "card.md"), "old", "utf8");
    const faults = new FaultController();
    faults.install("transaction:after-payload-prepare-before-journal", {
      kind: "throw",
      error: new Error("terminated before journal persistence")
    });

    await expect(
      runFileTransaction({
        operation: "payload-orphan-test",
        targets: [{ relativePath: "card.md", content: "new" }],
        vaultId: "vault-a",
        vaultPath: root,
        faults
      })
    ).rejects.toThrow("terminated before journal persistence");

    await recoverTransactions(root, "vault-a");
    const health = await inspectTransactionHealth(root);
    expect(health.blocked).toBe(false);
    expect(health.transactions).toEqual([
      expect.objectContaining({
        operation: "unknown",
        state: "orphaned",
        targets: [],
        allowedActions: ["export_recovery_bundle"]
      })
    ]);
    await expect(readFile(join(root, "card.md"), "utf8")).resolves.toBe("old");
  });

  it("recovers from a valid mirror when the primary journal is unreadable", async () => {
    const root = await vault();
    const target = join(root, "mirror-recovery.md");
    await writeFile(target, "old", "utf8");
    const faults = new FaultController();
    faults.install("transaction:after-prepare", {
      kind: "throw",
      error: new Error("stop after mirrored journal")
    });
    await expect(
      runFileTransaction({
        operation: "mirror-recovery-test",
        targets: [{ relativePath: "mirror-recovery.md", content: "new" }],
        vaultId: "vault-a",
        vaultPath: root,
        faults
      })
    ).rejects.toThrow("stop after mirrored journal");
    const [journalName] = await journalNames(root);
    await writeFile(
      join(root, ".aleksi", "transactions", journalName!),
      "{unreadable",
      "utf8"
    );

    await expect(recoverTransactions(root, "vault-a")).resolves.toMatchObject({
      committed: 1,
      quarantined: 0
    });
    await expect(readFile(target, "utf8")).resolves.toBe("new");
  });

  it("archives a readable journal whose payload directory disappeared", async () => {
    const root = await vault();
    const target = join(root, "missing-payload.md");
    await writeFile(target, "old", "utf8");
    const faults = new FaultController();
    faults.install("transaction:after-prepare", {
      kind: "throw",
      error: new Error("stop after prepare")
    });
    await expect(
      runFileTransaction({
        operation: "missing-payload-test",
        targets: [{ relativePath: "missing-payload.md", content: "new" }],
        vaultId: "vault-a",
        vaultPath: root,
        faults
      })
    ).rejects.toThrow("stop after prepare");
    const [journalName] = await journalNames(root);
    const transactionId = journalName!.replace(/\.json$/u, "");
    await rm(
      join(root, ".aleksi", "transactions", transactionId),
      { recursive: true }
    );

    await recoverTransactions(root, "vault-a");
    const health = await inspectTransactionHealth(root);
    expect(health.blocked).toBe(false);
    expect(health.transactions).toEqual([
      expect.objectContaining({
        transactionId,
        state: "orphaned",
        allowedActions: ["export_recovery_bundle"]
      })
    ]);
    await expect(readFile(target, "utf8")).resolves.toBe("old");
  });

  it("recovers all targets after termination between two writes", async () => {
    const root = await vault();
    await writeFile(join(root, "review.md"), "attempted", "utf8");
    await writeFile(join(root, "card.md"), "old-card", "utf8");
    const faults = new FaultController();
    faults.install("transaction:after-target:0", {
      kind: "throw",
      error: new Error("terminated between targets")
    });

    await expect(
      runFileTransaction({
        operation: "review-commit",
        targets: [
          { relativePath: "review.md", content: "committed" },
          { relativePath: "card.md", content: "reviewed-card" }
        ],
        vaultId: "vault-a",
        vaultPath: root,
        faults
      })
    ).rejects.toThrow("terminated between targets");

    await recoverTransactions(root, "vault-a");

    await expect(readFile(join(root, "review.md"), "utf8")).resolves.toBe(
      "committed"
    );
    await expect(readFile(join(root, "card.md"), "utf8")).resolves.toBe(
      "reviewed-card"
    );
  });

  it("recovers a write-and-delete archive transaction", async () => {
    const root = await vault();
    const original = join(root, "active.md");
    const archived = join(root, "archive.md");
    await writeFile(original, "active", "utf8");
    const faults = new FaultController();
    faults.install("transaction:after-target:0", {
      kind: "throw",
      error: new Error("terminated before source deletion")
    });

    await expect(
      runFileTransaction({
        operation: "card-archive",
        targets: [
          { relativePath: "archive.md", content: "archived" },
          { relativePath: "active.md", content: null }
        ],
        vaultId: "vault-a",
        vaultPath: root,
        faults
      })
    ).rejects.toThrow("terminated before source deletion");

    await recoverTransactions(root, "vault-a");

    await expect(readFile(archived, "utf8")).resolves.toBe("archived");
    await expect(readFile(original, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("recovers a selected vault before the switch response completes", async () => {
    const context = await createTempVaultContext();
    const root = context.path("Vault");
    const app = createApp();
    const initialized = await request(app)
      .post("/api/vault/initialize")
      .send({ path: root });
    expect(initialized.status).toBe(200);
    const target = join(root, "recover-on-select.md");
    await writeFile(target, "old", "utf8");
    const faults = new FaultController();
    faults.install("transaction:after-prepare", {
      kind: "throw",
      error: new Error("stop before apply")
    });
    await expect(
      runFileTransaction({
        operation: "switch-recovery-test",
        targets: [{ relativePath: "recover-on-select.md", content: "new" }],
        vaultId: await readVaultId(root),
        vaultPath: root,
        faults
      })
    ).rejects.toThrow("stop before apply");

    const selected = await request(app)
      .post("/api/vault/select")
      .send({ path: root });

    expect(selected.status).toBe(200);
    await expect(readFile(target, "utf8")).resolves.toBe("new");
    expect(await journalNames(root)).toEqual([]);
  });
});
