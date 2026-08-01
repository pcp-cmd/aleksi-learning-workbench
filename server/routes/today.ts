import { Router } from "express";
import { asyncRoute } from "../http/async-route";
import { getTodayNextInVault } from "../services/today-service";
import { withLibraryOperation } from "../http/library-request";

export function createTodayRouter(): Router {
  const router = Router();

  router.get(
    "/next",
    asyncRoute(async (request, response) => {
      await withLibraryOperation(request, response, async (context) => {
        response.json(await getTodayNextInVault(context));
      });
    })
  );

  return router;
}
