import { Router } from "express";
import { z } from "zod";
import { cardCreateInputSchema } from "../domain/schemas";
import { asyncRoute } from "../http/async-route";
import {
  archiveCardInVault,
  createCardInVault,
  getCardByIdInVault,
  listRecentCardsInVault,
  updateCardInVault
} from "../services/card-service";
import { withLibraryOperation } from "../http/library-request";

const cardIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
const recentCardsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(10).default(10)
  })
  .strict();

export function createCardsRouter(): Router {
  const router = Router();

  router.post(
    "/",
    asyncRoute(async (request, response) => {
      const input = cardCreateInputSchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        response.json(await createCardInVault(context, input));
      });
    })
  );

  router.get(
    "/recent",
    asyncRoute(async (request, response) => {
      const query = recentCardsQuerySchema.parse(request.query);
      await withLibraryOperation(request, response, async (context) => {
        response.json({
          cards: await listRecentCardsInVault(context, query.limit)
        });
      });
    })
  );

  router.get(
    "/:id",
    asyncRoute(async (request, response) => {
      const params = cardIdParamsSchema.parse(request.params);
      await withLibraryOperation(request, response, async (context) => {
        response.json({
          card: await getCardByIdInVault(context, params.id)
        });
      });
    })
  );

  router.put(
    "/:id",
    asyncRoute(async (request, response) => {
      const params = cardIdParamsSchema.parse(request.params);
      await withLibraryOperation(request, response, async (context) => {
        response.json(
          await updateCardInVault(context, params.id, request.body)
        );
      });
    })
  );

  router.post(
    "/:id/archive",
    asyncRoute(async (request, response) => {
      const params = cardIdParamsSchema.parse(request.params);
      await withLibraryOperation(request, response, async (context) => {
        response.json(
          await archiveCardInVault(context, params.id, request.body)
        );
      });
    })
  );

  return router;
}
