import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../http/async-route";
import { withLibraryOperation } from "../http/library-request";
import {
  inspectTransactionHealth,
  previewApplyIntended,
  resolveTransactionAction,
  transactionActionBodySchema
} from "../transactions/transaction-health";
import { readProjectionHealth } from "../projections/projection-health";
import { readBackupCleanupHealth } from "../services/vault-backup-service";
import { readQuarantineCleanupHealth } from "../lib/quarantine";

const transactionParamsSchema = z
  .object({ transactionId: z.string().uuid() })
  .strict();
const previewBodySchema = z
  .object({ action: z.literal("apply_intended_version") })
  .strict();

export function createLibraryHealthRouter(): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (request, response) => {
      await withLibraryOperation(request, response, async (context) => {
        response.json({
          ...(await inspectTransactionHealth(context.path)),
          projections: {
            index: await readProjectionHealth(context.path, "index")
          },
          backupCleanup: await readBackupCleanupHealth(context.path),
          quarantineCleanup: await readQuarantineCleanupHealth(context.path)
        });
      });
    })
  );

  router.post(
    "/transactions/:transactionId/preview",
    asyncRoute(async (request, response) => {
      const { transactionId } = transactionParamsSchema.parse(request.params);
      previewBodySchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        response.json(
          await previewApplyIntended(context.path, transactionId)
        );
      });
    })
  );

  router.post(
    "/transactions/:transactionId/actions",
    asyncRoute(async (request, response) => {
      const { transactionId } = transactionParamsSchema.parse(request.params);
      const body = transactionActionBodySchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        response.json(
          await resolveTransactionAction(
            context.path,
            context.vaultId,
            transactionId,
            body.action,
            body.previewToken
          )
        );
      });
    })
  );

  return router;
}
