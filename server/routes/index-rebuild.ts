import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../http/async-route";
import { withLibraryOperation } from "../http/library-request";
import { rebuildIndex } from "../services/index-service";
import { markProjectionFresh } from "../projections/projection-runner";

const rebuildBodySchema = z.object({ confirmed: z.literal(true) }).strict();

export function createIndexRebuildRouter(): Router {
  const router = Router();

  router.post(
    "/rebuild",
    asyncRoute(async (request, response) => {
      rebuildBodySchema.parse(request.body);

      await withLibraryOperation(request, response, async (context) => {
        const result = await rebuildIndex(context.path, {
          signal: context.signal
        });
        await markProjectionFresh(context.path, "index");
        response.json({
          ok: true,
          assetCount: result.index.assets.length,
          parseErrorCount: result.index.parseErrors.length,
          recoveredFromCorruption: result.recoveredFromCorruption
        });
      });
    })
  );

  return router;
}
