import { Router } from "express";
import { z } from "zod";
import { cardCreateInputSchema } from "../domain/schemas";
import { asyncRoute } from "../http/async-route";
import {
  archiveCard,
  createCard,
  getCardById,
  listRecentCards,
  updateCard
} from "../services/card-service";

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
      response.json(await createCard(input));
    })
  );

  router.get(
    "/recent",
    asyncRoute(async (request, response) => {
      const query = recentCardsQuerySchema.parse(request.query);
      response.json({ cards: await listRecentCards(query.limit) });
    })
  );

  router.get(
    "/:id",
    asyncRoute(async (request, response) => {
      const params = cardIdParamsSchema.parse(request.params);
      response.json({ card: await getCardById(params.id) });
    })
  );

  router.put(
    "/:id",
    asyncRoute(async (request, response) => {
      const params = cardIdParamsSchema.parse(request.params);
      response.json(await updateCard(params.id, request.body));
    })
  );

  router.post(
    "/:id/archive",
    asyncRoute(async (request, response) => {
      const params = cardIdParamsSchema.parse(request.params);
      response.json(await archiveCard(params.id, request.body));
    })
  );

  return router;
}
