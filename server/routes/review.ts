import { Router } from "express";
import { z } from "zod";
import {
  reviewAttemptInputSchema,
  reviewIdSchema,
  reviewResultInputSchema
} from "../domain/schemas";
import { asyncRoute } from "../http/async-route";
import {
  getReviewAttempt,
  getTodaysReviewQueue,
  startReviewAttempt,
  submitReviewResult
} from "../services/review-service";

const reviewCardParamsSchema = z.object({ id: z.string().uuid() }).strict();
const reviewAttemptParamsSchema = z
  .object({ attemptId: reviewIdSchema })
  .strict();

export function createReviewRouter(): Router {
  const router = Router();

  router.get(
    "/today",
    asyncRoute(async (_request, response) => {
      response.json(await getTodaysReviewQueue());
    })
  );

  router.get(
    "/attempts/:attemptId",
    asyncRoute(async (request, response) => {
      const params = reviewAttemptParamsSchema.parse(request.params);
      response.json(await getReviewAttempt(params.attemptId));
    })
  );

  router.post(
    "/:id/attempt",
    asyncRoute(async (request, response) => {
      const params = reviewCardParamsSchema.parse(request.params);
      const input = reviewAttemptInputSchema.parse(request.body);
      const result = await startReviewAttempt(params.id, input);
      response.status(result.replayed ? 200 : 201).json(result);
    })
  );

  router.post(
    "/:id/result",
    asyncRoute(async (request, response) => {
      const params = reviewCardParamsSchema.parse(request.params);
      const input = reviewResultInputSchema.parse(request.body);
      const result = await submitReviewResult(params.id, input);
      response.status(result.replayed ? 200 : 201).json(result);
    })
  );

  return router;
}
