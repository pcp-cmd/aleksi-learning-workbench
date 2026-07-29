import { Router } from "express";
import { z } from "zod";
import {
  reviewAttemptInputSchema,
  reviewIdSchema,
  reviewResultInputSchema
} from "../domain/schemas";
import { asyncRoute } from "../http/async-route";
import {
  getReviewAttemptInVault,
  getTodaysReviewQueueInVault,
  startReviewAttemptInVault,
  submitReviewResultInVault
} from "../services/review-service";
import { withLibraryOperation } from "../http/library-request";

const reviewCardParamsSchema = z.object({ id: z.string().uuid() }).strict();
const reviewAttemptParamsSchema = z
  .object({ attemptId: reviewIdSchema })
  .strict();

export function createReviewRouter(): Router {
  const router = Router();

  router.get(
    "/today",
    asyncRoute(async (request, response) => {
      await withLibraryOperation(request, response, async (context) => {
        response.json(await getTodaysReviewQueueInVault(context));
      });
    })
  );

  router.get(
    "/attempts/:attemptId",
    asyncRoute(async (request, response) => {
      const params = reviewAttemptParamsSchema.parse(request.params);
      await withLibraryOperation(request, response, async (context) => {
        response.json(
          await getReviewAttemptInVault(context, params.attemptId)
        );
      });
    })
  );

  router.post(
    "/:id/attempt",
    asyncRoute(async (request, response) => {
      const params = reviewCardParamsSchema.parse(request.params);
      const input = reviewAttemptInputSchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        const result = await startReviewAttemptInVault(
          context,
          params.id,
          input
        );
        response.status(result.replayed ? 200 : 201).json(result);
      });
    })
  );

  router.post(
    "/:id/result",
    asyncRoute(async (request, response) => {
      const params = reviewCardParamsSchema.parse(request.params);
      const input = reviewResultInputSchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        const result = await submitReviewResultInVault(
          context,
          params.id,
          input
        );
        response.status(result.replayed ? 200 : 201).json(result);
      });
    })
  );

  return router;
}
