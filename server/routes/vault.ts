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

async function setCurrentLibraryIdentityHeaders(
  response: Parameters<typeof writeLibraryIdentityHeaders>[0],
  leases: LibraryLeaseManager
): Promise<void> {
  const identity = await leases.currentIdentity();
  writeLibraryIdentityHeaders(response, identity);
}

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
      const status = await getActiveVaultStatus();
      if (status?.initialized === true) {
        await setCurrentLibraryIdentityHeaders(response, leases);
      }
      response.json({ status });
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
      const status = await leases.runExclusive(async () => {
        const prepared = await autoPrepareVault();
        await recoverSelectedVault(prepared);
        return prepared;
      });
      await setCurrentLibraryIdentityHeaders(response, leases);
      response.json({
        status
      });
    })
  );

  router.post(
    "/initialize",
    asyncRoute(async (request, response) => {
      const body = pathBodySchema.parse(request.body);
      const status = await leases.runExclusive(async () => {
        const initialized = await initializeVault(body.path);
        await recoverSelectedVault(initialized);
        return initialized;
      });
      await setCurrentLibraryIdentityHeaders(response, leases);
      response.json({
        status
      });
    })
  );

  router.post(
    "/select",
    asyncRoute(async (request, response) => {
      const body = pathBodySchema.parse(request.body);
      const status = await leases.runExclusive(async () => {
        const selected = await selectVault(body.path);
        await recoverSelectedVault(selected);
        return selected;
      });
      await setCurrentLibraryIdentityHeaders(response, leases);
      response.json({
        status
      });
    })
  );

  router.post(
    "/migrate",
    asyncRoute(async (request, response) => {
      const body = migrateBodySchema.parse(request.body);
      const status = await leases.runExclusive(async () => {
        const migrated = await migrateVault(
          body.sourcePath,
          body.destinationPath
        );
        await recoverSelectedVault(migrated);
        return migrated;
      });
      await setCurrentLibraryIdentityHeaders(response, leases);
      response.json({
        status
      });
    })
  );

  router.post(
    "/backup",
    asyncRoute(async (request, response) => {
      backupBodySchema.parse(request.body);
      const result = await leases.runExclusive(
        async () => backupActiveVault(),
        {
          incrementGeneration: false
        }
      );
      await setCurrentLibraryIdentityHeaders(response, leases);
      response.json(result);
    })
  );

  return router;
}
