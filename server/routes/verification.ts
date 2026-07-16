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
  createEvidenceCandidate,
  getEvidenceCandidate,
  getKnowledgeNodeProjection,
  listEvidenceCandidates,
  recordEvidenceVerdict,
  revokeEvidenceCandidate
} from "../services/verification-service";

const candidateParamsSchema = z.object({ id: evidenceIdSchema }).strict();
const knowledgeParamsSchema = z.object({ cardId: z.string().uuid() }).strict();

export function createVerificationRouter(): Router {
  const router = Router();

  router.get(
    "/candidates",
    asyncRoute(async (_request, response) => {
      response.json({ candidates: await listEvidenceCandidates() });
    })
  );

  router.get(
    "/knowledge/:cardId",
    asyncRoute(async (request, response) => {
      const params = knowledgeParamsSchema.parse(request.params);
      response.json({
        knowledge: await getKnowledgeNodeProjection(params.cardId)
      });
    })
  );

  router.post(
    "/candidates",
    asyncRoute(async (request, response) => {
      const input = evidenceCandidateCreateInputSchema.parse(request.body);
      const result = await createEvidenceCandidate(input);
      response.status(result.replayed ? 200 : 201).json(result);
    })
  );

  router.get(
    "/candidates/:id",
    asyncRoute(async (request, response) => {
      const params = candidateParamsSchema.parse(request.params);
      response.json({ candidate: await getEvidenceCandidate(params.id) });
    })
  );

  router.post(
    "/candidates/:id/verdict",
    asyncRoute(async (request, response) => {
      const params = candidateParamsSchema.parse(request.params);
      const input = evidenceVerdictInputSchema.parse(request.body);
      const result = await recordEvidenceVerdict(params.id, input);
      response.status(result.replayed ? 200 : 201).json(result);
    })
  );

  router.post(
    "/candidates/:id/revoke",
    asyncRoute(async (request, response) => {
      const params = candidateParamsSchema.parse(request.params);
      const input = evidenceRevocationInputSchema.parse(request.body);
      const result = await revokeEvidenceCandidate(params.id, input);
      response.status(result.replayed ? 200 : 201).json(result);
    })
  );

  return router;
}
