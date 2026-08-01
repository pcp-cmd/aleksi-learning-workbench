import { Router } from "express";
import { diagnosisCreateInputSchema } from "../domain/schemas";
import { asyncRoute } from "../http/async-route";
import { createDiagnosisInVault } from "../services/diagnosis-service";
import { withLibraryOperation } from "../http/library-request";

export function createDiagnosesRouter(): Router {
  const router = Router();

  router.post(
    "/",
    asyncRoute(async (request, response) => {
      const input = diagnosisCreateInputSchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        response.json(await createDiagnosisInVault(context, input));
      });
    })
  );

  return router;
}
