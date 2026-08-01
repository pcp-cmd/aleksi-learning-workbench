import { Router } from "express";
import { z } from "zod";
import {
  evidenceCandidateCreateInputSchema,
  evidenceIdSchema,
  evidenceRevocationInputSchema,
  evidenceVerdictInputSchema
} from "../domain/schemas";
import { asyncRoute } from "../http/async-route";
import {
  createEvidenceCandidateInVault,
  getEvidenceCandidateInVault,
  getKnowledgeNodeProjectionInVault,
  listEvidenceCandidatesInVault,
  recordEvidenceVerdictInVault,
  revokeEvidenceCandidateInVault
} from "../services/verification-service";
import { withLibraryOperation } from "../http/library-request";

const candidateParamsSchema = z.object({ id: evidenceIdSchema }).strict();
const knowledgeParamsSchema = z.object({ cardId: z.string().uuid() }).strict();

export function createVerificationRouter(): Router {
  const router = Router();

  router.get(
    "/candidates",
    asyncRoute(async (request, response) => {
      await withLibraryOperation(request, response, async (context) => {
        response.json(await listEvidenceCandidatesInVault(context));
      });
    })
  );

  router.get(
    "/knowledge/:cardId",
    asyncRoute(async (request, response) => {
      const params = knowledgeParamsSchema.parse(request.params);
      await withLibraryOperation(request, response, async (context) => {
        response.json({
          knowledge: await getKnowledgeNodeProjectionInVault(
            context,
            params.cardId
          )
        });
      });
    })
  );

  router.post(
    "/candidates",
    asyncRoute(async (request, response) => {
      const input = evidenceCandidateCreateInputSchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        const result = await createEvidenceCandidateInVault(context, input);
        response.status(result.replayed ? 200 : 201).json(result);
      });
    })
  );

  router.get(
    "/candidates/:id",
    asyncRoute(async (request, response) => {
      const params = candidateParamsSchema.parse(request.params);
      await withLibraryOperation(request, response, async (context) => {
        response.json({
          candidate: await getEvidenceCandidateInVault(context, params.id)
        });
      });
    })
  );

  router.post(
    "/candidates/:id/verdict",
    asyncRoute(async (request, response) => {
      const params = candidateParamsSchema.parse(request.params);
      const input = evidenceVerdictInputSchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        const result = await recordEvidenceVerdictInVault(
          context,
          params.id,
          input
        );
        response.status(result.replayed ? 200 : 201).json(result);
      });
    })
  );

  router.post(
    "/candidates/:id/revoke",
    asyncRoute(async (request, response) => {
      const params = candidateParamsSchema.parse(request.params);
      const input = evidenceRevocationInputSchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        const result = await revokeEvidenceCandidateInVault(
          context,
          params.id,
          input
        );
        response.status(result.replayed ? 200 : 201).json(result);
      });
    })
  );

  return router;
}
