import { Router } from "express";
import { asyncRoute } from "../http/async-route";
import { activeLearningLibrary } from "../persistence/library-context";
import { readGraphProjection } from "../services/graph-service";

export function createGraphRouter(): Router {
  const router = Router();

  router.get(
    "/state",
    asyncRoute(async (_request, response) => {
      response.json(
        await readGraphProjection(await activeLearningLibrary())
      );
    })
  );

  return router;
}
