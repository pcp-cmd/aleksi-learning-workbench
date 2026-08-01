import { Router } from "express";
import { asyncRoute } from "../http/async-route";
import { withLibraryOperation } from "../http/library-request";
import { readGraphProjection } from "../services/graph-service";

export function createGraphRouter(): Router {
  const router = Router();

  router.get(
    "/state",
    asyncRoute(async (request, response) => {
      await withLibraryOperation(request, response, async (context) => {
        response.json(await readGraphProjection(context));
      });
    })
  );

  return router;
}
