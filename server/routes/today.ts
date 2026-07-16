import { Router } from "express";
import { asyncRoute } from "../http/async-route";
import { getTodayNext } from "../services/today-service";

export function createTodayRouter(): Router {
  const router = Router();

  router.get(
    "/next",
    asyncRoute(async (_request, response) => {
      response.json(await getTodayNext());
    })
  );

  return router;
}
