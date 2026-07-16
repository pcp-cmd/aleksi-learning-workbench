import { Router } from "express";
import { codexTaskCreateInputSchema } from "../domain/schemas";
import { asyncRoute } from "../http/async-route";
import { createCodexTask } from "../services/codex-task-service";

export function createCodexRouter(): Router {
  const router = Router();

  router.post(
    "/tasks",
    asyncRoute(async (request, response) => {
      const input = codexTaskCreateInputSchema.parse(request.body);
      response.json(await createCodexTask(input));
    })
  );

  return router;
}
