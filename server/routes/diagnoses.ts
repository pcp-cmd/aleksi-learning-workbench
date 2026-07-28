import { Router } from "express";
import { diagnosisCreateInputSchema } from "../domain/schemas";
import { asyncRoute } from "../http/async-route";
import { createDiagnosisInVault } from "../services/diagnosis-service";
import { requestLibraryContext } from "../http/library-request";

export function createDiagnosesRouter(): Router {
  const router = Router();

  router.post(
    "/",
    asyncRoute(async (request, response) => {
      const input = diagnosisCreateInputSchema.parse(request.body);
      response.json(
        await createDiagnosisInVault(
          (await requestLibraryContext(response)).path,
          input
        )
      );
    })
  );

  return router;
}
