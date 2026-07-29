import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import {
  cleanupQuarantineRetentionCandidate,
  exportQuarantineRetentionCandidate,
  quarantineVaultPath,
  readQuarantineCleanupHealth
} from "../../server/lib/quarantine";
import {
  backupActiveVault
} from "../../server/services/vault-service";
import {
  cleanupBackupCandidate,
  exportBackupCandidate,
  readBackupCleanupHealth,
  restoreBackupToNewLocation
} from "../../server/services/vault-backup-service";
import { FaultController } from "../../server/testing/fault-controller";
import { READING_DIRECTORY } from "../../shared/vault-map";
import { createTempVaultContext, type TempVaultContext } from "../temp-vault";

let context: TempVaultContext;
let vaultPath: string;

beforeEach(async () => {
  context = await createTempVaultContext();
  vaultPath = context.path("Live Vault");
  const initialized = await request(createApp())
    .post("/api/vault/initialize")
    .send({ path: vaultPath });
  expect(initialized.status).toBe(200);
  await writeFile(
    join(vaultPath, READING_DIRECTORY, "中文阅读.md"),
    "# 中文阅读\n\n备份必须保留这些字节。\n",
    "utf8"
  );
});

async function createBackup(): Promise<string> {
  const response = await request(createApp())
    .post("/api/vault/backup")
    .send({ confirmed: true });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.backupPath as string;
}

describe("backup discovery and restore", () => {
  it("never discovers or exports the active library when its name resembles a backup", async () => {
    const protectedVaultPath = context.path(
      "Aleksi-Learning-Vault-backup-live-library"
    );
    const app = createApp();
    const initialized = await request(app)
      .post("/api/vault/initialize")
      .send({ path: protectedVaultPath });
    expect(initialized.status, JSON.stringify(initialized.body)).toBe(200);

    const discovered = await request(app).get("/api/vault/backups");
    expect(discovered.status, JSON.stringify(discovered.body)).toBe(200);
    expect(
      discovered.body.backups.some(
        (record: { path: string }) => record.path === protectedVaultPath
      )
    ).toBe(false);

    const exported = await request(app)
      .post("/api/vault/backups/export")
      .send({ candidatePath: protectedVaultPath });
    expect(exported.status).toBe(404);
    await expect(stat(protectedVaultPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
  });

  it("fails safely when the source changes after copy", async () => {
    const faults = new FaultController();
    faults.install("vault-transfer:copied", {
      kind: "callback",
      run: async () => {
        await writeFile(
          join(vaultPath, READING_DIRECTORY, "中文阅读.md"),
          "# 中文阅读\n\n源文件在复制后发生变化。\n",
          "utf8"
        );
      }
    });

    await expect(backupActiveVault({ faults })).rejects.toMatchObject({
      code: "HASH_VERIFICATION_FAILED"
    });
    const names = await readdir(dirname(vaultPath));
    expect(names.some((name) => name.includes(".partial-"))).toBe(false);
    expect(names.some((name) => name.endsWith(".manifest.json"))).toBe(false);
  });

  it("discovers a crash during copy as incomplete and a damaged verified partial as invalid", async () => {
    const copyingFaults = new FaultController();
    copyingFaults.install("vault-transfer:copying", {
      kind: "throw",
      error: new Error("terminated while copying")
    });
    await expect(backupActiveVault({ faults: copyingFaults })).rejects.toThrow(
      "terminated while copying"
    );

    const firstDiscovery = await request(createApp()).get("/api/vault/backups");
    expect(firstDiscovery.body.backups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "incomplete",
          path: expect.any(String)
        })
      ])
    );

    const readyFaults = new FaultController();
    readyFaults.install("vault-transfer:ready", {
      kind: "throw",
      error: new Error("terminated after verification")
    });
    await expect(backupActiveVault({ faults: readyFaults })).rejects.toThrow(
      "terminated after verification"
    );
    const verified = await request(createApp()).get("/api/vault/backups");
    const readyPartial = verified.body.backups.find(
      (record: { status: string }) =>
        record.status === "verified-needs-finalize"
    );
    expect(readyPartial?.path).toEqual(expect.any(String));
    await writeFile(
      join(readyPartial.path, READING_DIRECTORY, "中文阅读.md"),
      "damaged partial",
      "utf8"
    );

    const damaged = await request(createApp()).get("/api/vault/backups");
    expect(
      damaged.body.backups.find(
        (record: { path: string }) => record.path === readyPartial.path
      )
    ).toMatchObject({
      status: "invalid",
      diagnostics: expect.arrayContaining([expect.stringContaining("does not match")])
    });
  });

  it("does not finalize a backup when the external manifest still records copying", async () => {
    const faults = new FaultController();
    faults.install("vault-transfer:backup-manifest-written", {
      kind: "throw",
      error: new Error("terminated between embedded and external manifests")
    });
    await expect(backupActiveVault({ faults })).rejects.toThrow(
      "terminated between embedded and external manifests"
    );

    const app = createApp();
    const discovered = await request(app).get("/api/vault/backups");
    const pending = discovered.body.backups.find(
      (record: { status: string }) => record.status === "incomplete"
    );
    expect(pending).toEqual(
      expect.objectContaining({ path: expect.any(String) })
    );
    const finalized = await request(app)
      .post("/api/vault/backups/finalize")
      .send({ partialPath: pending.path, confirmed: true });
    expect(finalized.status).toBe(400);
    await expect(stat(pending.path)).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
  });

  it("discovers a verified backup and restores canonical content to a new selected location", async () => {
    const backupPath = await createBackup();
    const app = createApp();
    const discovered = await request(app).get("/api/vault/backups");
    expect(discovered.status).toBe(200);
    expect(discovered.body.backups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: backupPath,
          status: "verified",
          fileCount: expect.any(Number)
        })
      ])
    );

    const destinationPath = context.path("Restored Vault");
    const restored = await request(app)
      .post("/api/vault/backups/restore")
      .send({
        backupPath,
        destinationPath,
        confirmed: true
      });

    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body.status.path).toBe(destinationPath);
    await expect(
      readFile(
        join(destinationPath, READING_DIRECTORY, "中文阅读.md"),
        "utf8"
      )
    ).resolves.toBe("# 中文阅读\n\n备份必须保留这些字节。\n");
    await expect(
      readFile(join(backupPath, READING_DIRECTORY, "中文阅读.md"), "utf8")
    ).resolves.toBe("# 中文阅读\n\n备份必须保留这些字节。\n");
  });

  it("rejects a modified backup and a non-empty restore destination", async () => {
    const backupPath = await createBackup();
    await writeFile(
      join(backupPath, READING_DIRECTORY, "中文阅读.md"),
      "tampered",
      "utf8"
    );
    const invalidDestination = context.path("Invalid Restore");
    const invalid = await request(createApp())
      .post("/api/vault/backups/restore")
      .send({
        backupPath,
        destinationPath: invalidDestination,
        confirmed: true
      });
    expect(invalid.status).toBeGreaterThanOrEqual(400);
    await expect(stat(invalidDestination)).rejects.toMatchObject({
      code: "ENOENT"
    });

    const goodBackup = await createBackup();
    const nonEmpty = context.path("Non-empty");
    await writeFile(nonEmpty, "not a directory", "utf8");
    const blocked = await request(createApp())
      .post("/api/vault/backups/restore")
      .send({
        backupPath: goodBackup,
        destinationPath: nonEmpty,
        confirmed: true
      });
    expect(blocked.status).toBe(409);
  });

  it("preserves files created in the destination while restore verification is running", async () => {
    const backupPath = await createBackup();
    const destinationPath = context.path("Externally populated restore");
    await mkdir(destinationPath);
    const faults = new FaultController();
    faults.install("backup-restore:verified", {
      kind: "callback",
      run: async () => {
        await writeFile(
          join(destinationPath, "external-owner.txt"),
          "must survive\n",
          "utf8"
        );
      }
    });

    await expect(
      restoreBackupToNewLocation(backupPath, destinationPath, { faults })
    ).rejects.toMatchObject({
      code: "DESTINATION_NOT_EMPTY"
    });
    await expect(
      readFile(join(destinationPath, "external-owner.txt"), "utf8")
    ).resolves.toBe("must survive\n");
  });

  it("rejects restore destinations nested within the backup or active library", async () => {
    const backupPath = await createBackup();
    const app = createApp();
    for (const destinationPath of [
      join(backupPath, "Nested restore"),
      join(vaultPath, "Nested restore")
    ]) {
      const response = await request(app)
        .post("/api/vault/backups/restore")
        .send({
          backupPath,
          destinationPath,
          confirmed: true
        });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("SOURCE_DESTINATION_CONFLICT");
      await expect(stat(destinationPath)).rejects.toMatchObject({
        code: "ENOENT"
      });
    }
  });

  it("resumes after termination before and after the verified restore rename", async () => {
    const backupPath = await createBackup();
    for (const boundary of [
      "backup-restore:verified",
      "backup-restore:renamed"
    ] as const) {
      const destinationPath = context.path(`Resume ${boundary.split(":").at(-1)}`);
      const faults = new FaultController();
      faults.install(boundary, {
        kind: "throw",
        error: new Error(`terminated at ${boundary}`)
      });
      await expect(
        restoreBackupToNewLocation(backupPath, destinationPath, { faults })
      ).rejects.toThrow(`terminated at ${boundary}`);

      await expect(
        restoreBackupToNewLocation(backupPath, destinationPath)
      ).resolves.toMatchObject({
        destinationPath,
        fileCount: expect.any(Number)
      });
      await expect(
        readFile(
          join(destinationPath, READING_DIRECTORY, "中文阅读.md"),
          "utf8"
        )
      ).resolves.toContain("备份必须保留");
    }
  });

  it("classifies and finalizes a verified interrupted backup without recopying", async () => {
    const faults = new FaultController();
    faults.install("vault-transfer:ready", {
      kind: "throw",
      error: new Error("terminated before backup rename")
    });
    await expect(backupActiveVault({ faults })).rejects.toThrow(
      "terminated before backup rename"
    );

    const app = createApp();
    const discovered = await request(app).get("/api/vault/backups");
    const pending = discovered.body.backups.find(
      (record: { status: string }) =>
        record.status === "verified-needs-finalize"
    );
    expect(pending).toEqual(
      expect.objectContaining({ path: expect.any(String) })
    );

    const finalized = await request(app)
      .post("/api/vault/backups/finalize")
      .send({ partialPath: pending.path, confirmed: true });
    expect(finalized.status).toBe(200);
    expect(dirname(finalized.body.backupPath)).toBe(dirname(vaultPath));
    expect(
      (await readdir(dirname(vaultPath))).some((name) =>
        name === finalized.body.backupPath.split(/[\\/]/u).at(-1)
      )
    ).toBe(true);
  });

  it("rejects a forged interrupted-backup destination instead of trusting its manifest", async () => {
    const faults = new FaultController();
    faults.install("vault-transfer:ready", {
      kind: "throw",
      error: new Error("terminated before forged finalization")
    });
    await expect(backupActiveVault({ faults })).rejects.toThrow(
      "terminated before forged finalization"
    );

    const app = createApp();
    const discovered = await request(app).get("/api/vault/backups");
    const pending = discovered.body.backups.find(
      (record: { status: string }) =>
        record.status === "verified-needs-finalize"
    );
    const manifestPath = `${pending.path}.manifest.json`;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      finalPath: string;
    };
    const forgedDestination = context.path("Forged backup destination");
    manifest.finalPath = forgedDestination;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const finalized = await request(app)
      .post("/api/vault/backups/finalize")
      .send({ partialPath: pending.path, confirmed: true });
    expect(finalized.status).toBe(400);
    expect(finalized.body.error.code).toBe("HASH_VERIFICATION_FAILED");
    await expect(stat(forgedDestination)).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(stat(pending.path)).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
  });

  it("exports and cleans an orphan manifest after the backup rename boundary", async () => {
    const faults = new FaultController();
    faults.install("vault-transfer:renamed", {
      kind: "throw",
      error: new Error("terminated after backup rename")
    });
    await expect(backupActiveVault({ faults })).rejects.toThrow(
      "terminated after backup rename"
    );

    const app = createApp();
    const discovered = await request(app).get("/api/vault/backups");
    const orphan = discovered.body.backups.find(
      (record: { status: string }) => record.status === "orphaned"
    );
    const verified = discovered.body.backups.find(
      (record: { status: string }) => record.status === "verified"
    );
    expect(orphan).toEqual(
      expect.objectContaining({
        path: expect.stringMatching(/\.manifest\.json$/u)
      })
    );
    expect(verified).toEqual(
      expect.objectContaining({ path: expect.any(String) })
    );

    const exported = await request(app)
      .post("/api/vault/backups/export")
      .send({ candidatePath: orphan.path });
    expect(exported.status, JSON.stringify(exported.body)).toBe(200);
    const cleaned = await request(app)
      .post("/api/vault/backups/cleanup")
      .send({
        candidatePath: orphan.path,
        exportToken: exported.body.exportToken,
        confirmed: true
      });
    expect(cleaned.status, JSON.stringify(cleaned.body)).toBe(200);
    await expect(stat(orphan.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(verified.path)).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
  });

  it("requires an exported current inventory and explicit confirmation before retention cleanup", async () => {
    const backupPath = await createBackup();
    const app = createApp();

    const missingConfirmation = await request(app)
      .post("/api/vault/backups/cleanup")
      .send({
        candidatePath: backupPath,
        exportToken: "0".repeat(64)
      });
    expect(missingConfirmation.status).toBe(422);

    const staleExport = await request(app)
      .post("/api/vault/backups/cleanup")
      .send({
        candidatePath: backupPath,
        exportToken: "0".repeat(64),
        confirmed: true
      });
    expect(staleExport.status).toBe(409);
    await expect(stat(backupPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });

    const exported = await request(app)
      .post("/api/vault/backups/export")
      .send({ candidatePath: backupPath });
    expect(exported.status, JSON.stringify(exported.body)).toBe(200);
    expect(exported.body).toMatchObject({
      candidate: { path: backupPath, status: "verified" },
      files: expect.any(Array),
      exportToken: expect.stringMatching(/^[0-9a-f]{64}$/u)
    });

    const cleaned = await request(app)
      .post("/api/vault/backups/cleanup")
      .send({
        candidatePath: backupPath,
        exportToken: exported.body.exportToken,
        confirmed: true
      });
    expect(cleaned.status, JSON.stringify(cleaned.body)).toBe(200);
    expect(cleaned.body.exportReceipt.exportToken).toBe(
      exported.body.exportToken
    );
    expect(cleaned.body.health.status).toBe("healthy");
    await expect(stat(backupPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exports quarantine evidence before confirmed retention cleanup", async () => {
    const quarantinedSource = join(vaultPath, ".aleksi", "damaged-index.json");
    await writeFile(quarantinedSource, "{damaged", "utf8");
    await expect(
      quarantineVaultPath(
        vaultPath,
        "projections",
        ".aleksi/damaged-index.json",
        "INVALID_PROJECTION_JSON"
      )
    ).resolves.toMatchObject({
      category: "projections",
      originalRelativePath: ".aleksi/damaged-index.json"
    });

    const app = createApp();
    const inventory = await request(app).get("/api/vault/quarantine");
    expect(inventory.status, JSON.stringify(inventory.body)).toBe(200);
    expect(inventory.body.candidates).toHaveLength(1);
    const candidate = inventory.body.candidates[0] as {
      relativePath: string;
      category: string;
    };
    expect(candidate).toMatchObject({
      category: "projections",
      relativePath: expect.stringMatching(
        /^\.aleksi\/quarantine\/projections\//u
      )
    });

    const missingConfirmation = await request(app)
      .post("/api/vault/quarantine/cleanup")
      .send({
        relativePath: candidate.relativePath,
        exportToken: "0".repeat(64)
      });
    expect(missingConfirmation.status).toBe(422);

    const exported = await request(app)
      .post("/api/vault/quarantine/export")
      .send({ relativePath: candidate.relativePath });
    expect(exported.status, JSON.stringify(exported.body)).toBe(200);
    expect(exported.body).toMatchObject({
      candidate,
      files: expect.arrayContaining([
        expect.objectContaining({
          relativePath: "artifact",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/u)
        }),
        expect.objectContaining({
          relativePath: "manifest.json",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/u)
        })
      ]),
      exportToken: expect.stringMatching(/^[0-9a-f]{64}$/u)
    });

    const cleaned = await request(app)
      .post("/api/vault/quarantine/cleanup")
      .send({
        relativePath: candidate.relativePath,
        exportToken: exported.body.exportToken,
        confirmed: true
      });
    expect(cleaned.status, JSON.stringify(cleaned.body)).toBe(200);
    expect(cleaned.body.exportReceipt.exportToken).toBe(
      exported.body.exportToken
    );
    await expect(
      stat(join(vaultPath, ...candidate.relativePath.split("/")))
    ).rejects.toMatchObject({ code: "ENOENT" });

    const damagedRelativePath =
      ".aleksi/quarantine/verification/damaged-bundle";
    const damagedPath = join(vaultPath, ...damagedRelativePath.split("/"));
    await mkdir(damagedPath, { recursive: true });
    await writeFile(join(damagedPath, "artifact"), "damaged evidence\n", "utf8");
    await writeFile(join(damagedPath, "manifest.json"), "{broken", "utf8");

    const damagedExport = await request(app)
      .post("/api/vault/quarantine/export")
      .send({ relativePath: damagedRelativePath });
    expect(damagedExport.status, JSON.stringify(damagedExport.body)).toBe(200);
    expect(damagedExport.body.files).toHaveLength(2);
    await writeFile(
      join(damagedPath, "artifact"),
      "damaged evidence changed after export\n",
      "utf8"
    );
    const staleCleanup = await request(app)
      .post("/api/vault/quarantine/cleanup")
      .send({
        relativePath: damagedRelativePath,
        exportToken: damagedExport.body.exportToken,
        confirmed: true
      });
    expect(staleCleanup.status).toBe(409);
    await expect(stat(damagedPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });

    const refreshedExport = await request(app)
      .post("/api/vault/quarantine/export")
      .send({ relativePath: damagedRelativePath });
    expect(refreshedExport.status, JSON.stringify(refreshedExport.body)).toBe(
      200
    );
    const damagedCleanup = await request(app)
      .post("/api/vault/quarantine/cleanup")
      .send({
        relativePath: damagedRelativePath,
        exportToken: refreshedExport.body.exportToken,
        confirmed: true
      });
    expect(
      damagedCleanup.status,
      JSON.stringify(damagedCleanup.body)
    ).toBe(200);
    await expect(stat(damagedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records a retention cleanup failure in learning-library health", async () => {
    const backupPath = await createBackup();
    const exported = await exportBackupCandidate(vaultPath, backupPath);

    await expect(
      cleanupBackupCandidate(vaultPath, backupPath, exported.exportToken, {
        remove: async () => {
          throw new Error("simulated cleanup denial");
        }
      })
    ).rejects.toMatchObject({
      code: "BACKUP_RETENTION_CLEANUP_FAILED"
    });
    await expect(readBackupCleanupHealth(vaultPath)).resolves.toMatchObject({
      status: "failed",
      category: "BACKUP_RETENTION_CLEANUP_FAILED",
      candidateName: backupPath.split(/[\\/]/u).at(-1)
    });

    const health = await request(createApp()).get("/api/vault/health");
    expect(health.status, JSON.stringify(health.body)).toBe(200);
    expect(health.body.backupCleanup).toMatchObject({
      status: "failed",
      attempts: 1
    });
    await expect(stat(backupPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
  });

  it("records a quarantine cleanup failure in learning-library health", async () => {
    const sourcePath = join(vaultPath, ".aleksi", "damaged-health.json");
    await writeFile(sourcePath, "{damaged", "utf8");
    await quarantineVaultPath(
      vaultPath,
      "projections",
      ".aleksi/damaged-health.json",
      "INVALID_PROJECTION_JSON"
    );
    const [candidate] = (
      await request(createApp()).get("/api/vault/quarantine")
    ).body.candidates as Array<{ relativePath: string }>;
    const exported = await exportQuarantineRetentionCandidate(
      vaultPath,
      candidate.relativePath
    );

    await expect(
      cleanupQuarantineRetentionCandidate(
        vaultPath,
        candidate.relativePath,
        exported.exportToken,
        {
          remove: async () => {
            throw new Error("simulated quarantine cleanup denial");
          }
        }
      )
    ).rejects.toMatchObject({
      code: "QUARANTINE_RETENTION_CLEANUP_FAILED"
    });
    await expect(readQuarantineCleanupHealth(vaultPath)).resolves.toMatchObject({
      status: "failed",
      attempts: 1,
      category: "QUARANTINE_RETENTION_CLEANUP_FAILED",
      candidateRelativePath: candidate.relativePath
    });

    const health = await request(createApp()).get("/api/vault/health");
    expect(health.status, JSON.stringify(health.body)).toBe(200);
    expect(health.body.quarantineCleanup).toMatchObject({
      status: "failed",
      attempts: 1
    });
    await expect(
      stat(join(vaultPath, ...candidate.relativePath.split("/")))
    ).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
  });
});
