import { Router } from "express";
import { diagnosisCreateInputSchema } from "../domain/schemas";
import { asyncRoute } from "../http/async-route";
import { createDiagnosis } from "../services/diagnosis-service";

export function createDiagnosesRouter(): Router {
  const router = Router();

  router.post(
    "/",
    asyncRoute(async (request, response) => {
      const input = diagnosisCreateInputSchema.parse(request.body);
      response.json(await createDiagnosis(input));
    })
  );

  return router;
}
