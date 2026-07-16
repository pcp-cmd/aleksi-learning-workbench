import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../http/async-route";
import { activeLearningLibrary } from "../persistence/library-context";
import { rebuildIndex } from "../services/index-service";

const rebuildBodySchema = z.object({ confirmed: z.literal(true) }).strict();

export function createIndexRebuildRouter(): Router {
  const router = Router();

  router.post(
    "/rebuild",
    asyncRoute(async (request, response) => {
      rebuildBodySchema.parse(request.body);

      const result = await rebuildIndex(await activeLearningLibrary());
      response.json({
        ok: true,
        assetCount: result.index.assets.length,
        parseErrorCount: result.index.parseErrors.length,
        recoveredFromCorruption: result.recoveredFromCorruption
      });
    })
  );

  return router;
}
