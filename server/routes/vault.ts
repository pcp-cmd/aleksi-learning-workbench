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
        { incrementGeneration: false }
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
      const snapshot = await leases.runExclusiveWithContext(async () => {
        const prepared = await autoPrepareVault();
        await recoverSelectedVault(prepared);
        return prepared;
      });
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
      const snapshot = await leases.runExclusiveWithContext(async () => {
        const initialized = await initializeVault(body.path);
        await recoverSelectedVault(initialized);
        return initialized;
      });
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
      const snapshot = await leases.runExclusiveWithContext(async () => {
        const selected = await selectVault(body.path);
        await recoverSelectedVault(selected);
        return selected;
      });
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
      const snapshot = await leases.runExclusiveWithContext(async () => {
        const migrated = await migrateVault(
          body.sourcePath,
          body.destinationPath
        );
        await recoverSelectedVault(migrated);
        return migrated;
      });
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
          incrementGeneration: false
        }
      );
      writeLibraryIdentityHeaders(response, snapshot.context);
      response.json(snapshot.result);
    })
  );

  return router;
}
