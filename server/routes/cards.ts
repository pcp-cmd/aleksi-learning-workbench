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
import {
  listCardLibraryInVault
} from "../services/card-library-service";
import { CARD_TYPES } from "../../shared/card-types";

const cardIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
const recentCardsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(10).default(10)
  })
  .strict();
const cardLibraryQuerySchema = z
  .object({
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    query: z.string().trim().max(120).optional(),
    type: z.enum(CARD_TYPES).optional(),
    mastery: z
      .enum(["learning", "due", "mastered", "rebuild", "archived"])
      .optional(),
    due: z.enum(["overdue", "today", "future", "none"]).optional(),
    sort: z.enum(["updated", "created", "title", "due"]).default("updated"),
    order: z.enum(["asc", "desc"]).default("desc")
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
    "/library",
    asyncRoute(async (request, response) => {
      const query = cardLibraryQuerySchema.parse(request.query);
      await withLibraryOperation(request, response, async (context) => {
        response.json(await listCardLibraryInVault(context, query));
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
