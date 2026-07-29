import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../http/async-route";
import {
  autoPrepareVault,
  backupActiveVault,
  defaultLearningLibraryPath,
  getActiveVaultStatus,
  initializeVault,
  migrateVault,
  selectVault
} from "../services/vault-service";
import {
  cleanupBackupCandidate,
  discoverBackups,
  exportBackupCandidate,
  finalizeInterruptedBackup,
  restoreBackupToNewLocation
} from "../services/vault-backup-service";
import {
  cleanupQuarantineRetentionCandidate,
  exportQuarantineRetentionCandidate,
  listQuarantineRetentionCandidates
} from "../lib/quarantine";
import { VaultServiceError } from "../services/vault-service";
import {
  libraryLeaseManager,
  type LibraryLeaseManager
} from "../persistence/library-lease";
import { recoverTransactions } from "../transactions/transaction-recovery";
import { readVaultId } from "../services/vault-service";
import {
  setLibraryIdentityHeaders as writeLibraryIdentityHeaders
} from "../http/library-request";

const pathBodySchema = z.object({ path: z.string() }).strict();
const migrateBodySchema = z
  .object({
    sourcePath: z.string(),
    destinationPath: z.string(),
    confirmed: z.literal(true)
  })
  .strict();
const backupBodySchema = z.object({ confirmed: z.literal(true) }).strict();
const restoreBackupBodySchema = z
  .object({
    backupPath: z.string(),
    destinationPath: z.string(),
    confirmed: z.literal(true)
  })
  .strict();
const finalizeBackupBodySchema = z
  .object({
    partialPath: z.string(),
    confirmed: z.literal(true)
  })
  .strict();
const exportBackupBodySchema = z
  .object({ candidatePath: z.string() })
  .strict();
const cleanupBackupBodySchema = z
  .object({
    candidatePath: z.string(),
    exportToken: z.string().regex(/^[0-9a-f]{64}$/u),
    confirmed: z.literal(true)
  })
  .strict();
const quarantineCandidateBodySchema = z
  .object({ relativePath: z.string() })
  .strict();
const cleanupQuarantineBodySchema = z
  .object({
    relativePath: z.string(),
    exportToken: z.string().regex(/^[0-9a-f]{64}$/u),
    confirmed: z.literal(true)
  })
  .strict();
const LIBRARY_EXCLUSIVE_TIMEOUT_MS = 5_000;

async function recoverSelectedVault(status: { path: string }): Promise<void> {
  await recoverTransactions(status.path, await readVaultId(status.path));
}

export function createVaultRouter(
  leases: LibraryLeaseManager = libraryLeaseManager
): Router {
  const router = Router();

  router.get(
    "/status",
    asyncRoute(async (_request, response) => {
      const snapshot = await leases.runExclusive(
        async (nextGeneration) => {
          const status = await getActiveVaultStatus();
          return {
            status,
            context:
              status?.initialized === true
                ? {
                    path: status.path,
                    vaultId: await readVaultId(status.path),
                    generation: nextGeneration - 1
                  }
                : null
          };
        },
        {
          incrementGeneration: false,
          timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS
        }
      );
      if (snapshot.context !== null) {
        writeLibraryIdentityHeaders(response, snapshot.context);
      }
      response.json({ status: snapshot.status });
    })
  );

  router.get(
    "/recommended-path",
    asyncRoute(async (_request, response) => {
      response.json({ path: defaultLearningLibraryPath() });
    })
  );

  router.post(
    "/auto-prepare",
    asyncRoute(async (_request, response) => {
      const snapshot = await leases.runExclusiveWithContext(
        async () => {
          const prepared = await autoPrepareVault();
          await recoverSelectedVault(prepared);
          return prepared;
        },
        { timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS }
      );
      writeLibraryIdentityHeaders(response, snapshot.context);
      response.json({
        status: snapshot.result
      });
    })
  );

  router.post(
    "/initialize",
    asyncRoute(async (request, response) => {
      const body = pathBodySchema.parse(request.body);
      const snapshot = await leases.runExclusiveWithContext(
        async () => {
          const initialized = await initializeVault(body.path);
          await recoverSelectedVault(initialized);
          return initialized;
        },
        { timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS }
      );
      writeLibraryIdentityHeaders(response, snapshot.context);
      response.json({
        status: snapshot.result
      });
    })
  );

  router.post(
    "/select",
    asyncRoute(async (request, response) => {
      const body = pathBodySchema.parse(request.body);
      const snapshot = await leases.runExclusiveWithContext(
        async () => {
          const selected = await selectVault(body.path);
          await recoverSelectedVault(selected);
          return selected;
        },
        { timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS }
      );
      writeLibraryIdentityHeaders(response, snapshot.context);
      response.json({
        status: snapshot.result
      });
    })
  );

  router.post(
    "/migrate",
    asyncRoute(async (request, response) => {
      const body = migrateBodySchema.parse(request.body);
      const snapshot = await leases.runExclusiveWithContext(
        async () => {
          const migrated = await migrateVault(
            body.sourcePath,
            body.destinationPath
          );
          await recoverSelectedVault(migrated);
          return migrated;
        },
        { timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS }
      );
      writeLibraryIdentityHeaders(response, snapshot.context);
      response.json({
        status: snapshot.result
      });
    })
  );

  router.post(
    "/backup",
    asyncRoute(async (request, response) => {
      backupBodySchema.parse(request.body);
      const snapshot = await leases.runExclusiveWithContext(
        async () => backupActiveVault(),
        {
          incrementGeneration: false,
          timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS
        }
      );
      writeLibraryIdentityHeaders(response, snapshot.context);
      response.json(snapshot.result);
    })
  );

  router.get(
    "/backups",
    asyncRoute(async (_request, response) => {
      const result = await leases.runExclusive(
        async () => {
          const status = await getActiveVaultStatus();
          if (status?.initialized !== true) {
            throw new VaultServiceError(
              "VAULT_NOT_INITIALIZED",
              "Initialize a learning library before inspecting backups",
              409
            );
          }
          return discoverBackups(status.path);
        },
        {
          incrementGeneration: false,
          timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS
        }
      );
      response.json({ backups: result });
    })
  );

  router.post(
    "/backups/restore",
    asyncRoute(async (request, response) => {
      const body = restoreBackupBodySchema.parse(request.body);
      const snapshot = await leases.runExclusiveWithContext(
        async () => {
          const activeStatus = await getActiveVaultStatus();
          if (activeStatus?.initialized !== true) {
            throw new VaultServiceError(
              "VAULT_NOT_INITIALIZED",
              "Initialize a learning library before restoring a backup",
              409
            );
          }
          const restored = await restoreBackupToNewLocation(
            body.backupPath,
            body.destinationPath,
            { activeVaultPath: activeStatus.path }
          );
          const selected = await selectVault(restored.destinationPath);
          await recoverSelectedVault(selected);
          return { restored, status: selected };
        },
        { timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS }
      );
      writeLibraryIdentityHeaders(response, snapshot.context);
      response.json(snapshot.result);
    })
  );

  router.post(
    "/backups/finalize",
    asyncRoute(async (request, response) => {
      const body = finalizeBackupBodySchema.parse(request.body);
      const result = await leases.runExclusive(
        async () => {
          const status = await getActiveVaultStatus();
          if (status?.initialized !== true) {
            throw new VaultServiceError(
              "VAULT_NOT_INITIALIZED",
              "Initialize a learning library before finalizing a backup",
              409
            );
          }
          return finalizeInterruptedBackup(
            status.path,
            await readVaultId(status.path),
            body.partialPath
          );
        },
        {
          incrementGeneration: false,
          timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS
        }
      );
      response.json(result);
    })
  );

  router.post(
    "/backups/export",
    asyncRoute(async (request, response) => {
      const body = exportBackupBodySchema.parse(request.body);
      const result = await leases.runExclusive(
        async () => {
          const status = await getActiveVaultStatus();
          if (status?.initialized !== true) {
            throw new VaultServiceError(
              "VAULT_NOT_INITIALIZED",
              "Initialize a learning library before exporting backup evidence",
              409
            );
          }
          return exportBackupCandidate(status.path, body.candidatePath);
        },
        {
          incrementGeneration: false,
          timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS
        }
      );
      response.json(result);
    })
  );

  router.post(
    "/backups/cleanup",
    asyncRoute(async (request, response) => {
      const body = cleanupBackupBodySchema.parse(request.body);
      const result = await leases.runExclusive(
        async () => {
          const status = await getActiveVaultStatus();
          if (status?.initialized !== true) {
            throw new VaultServiceError(
              "VAULT_NOT_INITIALIZED",
              "Initialize a learning library before cleaning backup evidence",
              409
            );
          }
          return cleanupBackupCandidate(
            status.path,
            body.candidatePath,
            body.exportToken
          );
        },
        {
          incrementGeneration: false,
          timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS
        }
      );
      response.json(result);
    })
  );

  router.get(
    "/quarantine",
    asyncRoute(async (_request, response) => {
      const result = await leases.runExclusive(
        async () => {
          const status = await getActiveVaultStatus();
          if (status?.initialized !== true) {
            throw new VaultServiceError(
              "VAULT_NOT_INITIALIZED",
              "Initialize a learning library before inspecting quarantine evidence",
              409
            );
          }
          return listQuarantineRetentionCandidates(status.path);
        },
        {
          incrementGeneration: false,
          timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS
        }
      );
      response.json({ candidates: result });
    })
  );

  router.post(
    "/quarantine/export",
    asyncRoute(async (request, response) => {
      const body = quarantineCandidateBodySchema.parse(request.body);
      const result = await leases.runExclusive(
        async () => {
          const status = await getActiveVaultStatus();
          if (status?.initialized !== true) {
            throw new VaultServiceError(
              "VAULT_NOT_INITIALIZED",
              "Initialize a learning library before exporting quarantine evidence",
              409
            );
          }
          return exportQuarantineRetentionCandidate(
            status.path,
            body.relativePath
          );
        },
        {
          incrementGeneration: false,
          timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS
        }
      );
      response.json(result);
    })
  );

  router.post(
    "/quarantine/cleanup",
    asyncRoute(async (request, response) => {
      const body = cleanupQuarantineBodySchema.parse(request.body);
      const result = await leases.runExclusive(
        async () => {
          const status = await getActiveVaultStatus();
          if (status?.initialized !== true) {
            throw new VaultServiceError(
              "VAULT_NOT_INITIALIZED",
              "Initialize a learning library before cleaning quarantine evidence",
              409
            );
          }
          return cleanupQuarantineRetentionCandidate(
            status.path,
            body.relativePath,
            body.exportToken
          );
        },
        {
          incrementGeneration: false,
          timeoutMs: LIBRARY_EXCLUSIVE_TIMEOUT_MS
        }
      );
      response.json(result);
    })
  );

  return router;
}
