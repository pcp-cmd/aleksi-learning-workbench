import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../http/async-route";
import type { RuntimeLifecycle } from "../runtime/lifecycle";

const exitBodySchema = z.object({ confirmed: z.literal(true) }).strict();

export function createRuntimeRouter(lifecycle: RuntimeLifecycle): Router {
  const router = Router();

  router.get("/capabilities", (_request, response) => {
    response.json(lifecycle.capabilities);
  });

  router.post(
    "/open-library",
    asyncRoute(async (_request, response) => {
      await lifecycle.openLearningLibrary();
      response.json({ opened: true });
    })
  );

  router.get(
    "/diagnostics",
    asyncRoute(async (_request, response) => {
      const report = await lifecycle.createDiagnosticReport();
      response
        .attachment("aleksi-workbench-diagnostics.json")
        .type("application/json")
        .send(`${JSON.stringify(report, null, 2)}\n`);
    })
  );

  router.post(
    "/exit",
    asyncRoute(async (request, response) => {
      exitBodySchema.parse(request.body);
      if (!lifecycle.capabilities.exitWorkbench) {
        lifecycle.requestExit();
      }

      response.once("finish", () => {
        lifecycle.requestExit();
      });
      response.json({ exiting: true });
    })
  );

  return router;
}
