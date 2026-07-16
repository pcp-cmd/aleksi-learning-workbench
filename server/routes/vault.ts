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

const pathBodySchema = z.object({ path: z.string() }).strict();
const migrateBodySchema = z
  .object({
    sourcePath: z.string(),
    destinationPath: z.string(),
    confirmed: z.literal(true)
  })
  .strict();
const backupBodySchema = z.object({ confirmed: z.literal(true) }).strict();

export function createVaultRouter(): Router {
  const router = Router();

  router.get(
    "/status",
    asyncRoute(async (_request, response) => {
      response.json({ status: await getActiveVaultStatus() });
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
      response.json({ status: await autoPrepareVault() });
    })
  );

  router.post(
    "/initialize",
    asyncRoute(async (request, response) => {
      const body = pathBodySchema.parse(request.body);
      response.json({ status: await initializeVault(body.path) });
    })
  );

  router.post(
    "/select",
    asyncRoute(async (request, response) => {
      const body = pathBodySchema.parse(request.body);
      response.json({ status: await selectVault(body.path) });
    })
  );

  router.post(
    "/migrate",
    asyncRoute(async (request, response) => {
      const body = migrateBodySchema.parse(request.body);
      response.json({
        status: await migrateVault(body.sourcePath, body.destinationPath)
      });
    })
  );

  router.post(
    "/backup",
    asyncRoute(async (request, response) => {
      backupBodySchema.parse(request.body);
      response.json(await backupActiveVault());
    })
  );

  return router;
}
