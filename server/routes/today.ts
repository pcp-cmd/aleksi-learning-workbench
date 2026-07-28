import { Router } from "express";
import { asyncRoute } from "../http/async-route";
import { getTodayNextInVault } from "../services/today-service";
import { requestLibraryContext } from "../http/library-request";

export function createTodayRouter(): Router {
  const router = Router();

  router.get(
    "/next",
    asyncRoute(async (_request, response) => {
      response.json(
        await getTodayNextInVault(
          (await requestLibraryContext(response)).path
        )
      );
    })
  );

  return router;
}
