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
import {
  assertRequestLibraryCurrent,
  requestLibraryContext
} from "../http/library-request";

const reviewCardParamsSchema = z.object({ id: z.string().uuid() }).strict();
const reviewAttemptParamsSchema = z
  .object({ attemptId: reviewIdSchema })
  .strict();

export function createReviewRouter(): Router {
  const router = Router();

  router.get(
    "/today",
    asyncRoute(async (_request, response) => {
      response.json(
        await getTodaysReviewQueueInVault(
          (await requestLibraryContext(response)).path
        )
      );
    })
  );

  router.get(
    "/attempts/:attemptId",
    asyncRoute(async (request, response) => {
      const params = reviewAttemptParamsSchema.parse(request.params);
      response.json(
        await getReviewAttemptInVault(
          (await requestLibraryContext(response)).path,
          params.attemptId
        )
      );
    })
  );

  router.post(
    "/:id/attempt",
    asyncRoute(async (request, response) => {
      const params = reviewCardParamsSchema.parse(request.params);
      const input = reviewAttemptInputSchema.parse(request.body);
      const result = await startReviewAttemptInVault(
        (await requestLibraryContext(response)).path,
        params.id,
        input
      );
      response.status(result.replayed ? 200 : 201).json(result);
    })
  );

  router.post(
    "/:id/result",
    asyncRoute(async (request, response) => {
      const params = reviewCardParamsSchema.parse(request.params);
      const input = reviewResultInputSchema.parse(request.body);
      const context = await requestLibraryContext(response);
      const result = await submitReviewResultInVault(
        context.path,
        params.id,
        input,
        () => assertRequestLibraryCurrent(response)
      );
      response.status(result.replayed ? 200 : 201).json(result);
    })
  );

  return router;
}
