import { Router } from "express";
import { codexTaskCreateInputSchema } from "../domain/schemas";
import { asyncRoute } from "../http/async-route";
import { createCodexTaskInVault } from "../services/codex-task-service";
import { withLibraryOperation } from "../http/library-request";

export function createCodexRouter(): Router {
  const router = Router();

  router.post(
    "/tasks",
    asyncRoute(async (request, response) => {
      const input = codexTaskCreateInputSchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        response.json(await createCodexTaskInVault(context, input));
      });
    })
  );

  return router;
}
