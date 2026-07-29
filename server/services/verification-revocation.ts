import { evidenceRevocationInputSchema } from "../domain/schemas";
import type { EvidenceRevocationInput } from "../domain/types";
import type { LibraryOperationContext } from "../persistence/library-context";
import { getCardByIdInVault } from "./card-service";
import {
  VerificationServiceError,
  revocationIdFor,
  statusFor
} from "./verification-domain";
import type {
  EvidenceCandidateDetail,
  EvidenceRevocationRecord,
  KnowledgeNodeProjection
} from "./verification-domain";
import { revocationMarkdown, verificationPrompt } from "./verification-format";
import {
  buildKnowledgeNodeProjection,
  buildRevocationImpacts,
  toEvidenceSummary
} from "./verification-projection";
import {
  candidateById,
  createVerificationFile,
  readVerificationState,
  vaultRelativePath
} from "./verification-store";

async function detailInVault(
  context: LibraryOperationContext,
  candidateId: string
): Promise<EvidenceCandidateDetail> {
  const vaultPath = context.path;
  const found = await candidateById(vaultPath, candidateId, context.signal);
  if (found === null) {
    throw new VerificationServiceError(
      "EVIDENCE_CANDIDATE_NOT_FOUND",
      "Evidence candidate was not found",
      404
    );
  }
  return {
    ...toEvidenceSummary(found.record, await readVerificationState(vaultPath, context.signal)),
    cardPath: found.record.cardPath,
    proofAttempt: found.record.proofAttempt,
    relativePath: vaultRelativePath(vaultPath, found.absolutePath),
    verificationPrompt: verificationPrompt(found.record)
  };
}

export async function revokeEvidenceCandidateInVault(
  context: LibraryOperationContext,
  candidateId: string,
  rawInput: EvidenceRevocationInput
): Promise<{
  candidate: EvidenceCandidateDetail;
  revocation: EvidenceRevocationRecord;
  replayed: boolean;
}> {
  const vaultPath = context.path;
  context.assertCurrent();
  const input = evidenceRevocationInputSchema.parse(rawInput);
  const state = await readVerificationState(vaultPath, context.signal);
  const root = state.candidates.find((candidate) => candidate.id === candidateId);
  if (root === undefined) {
    throw new VerificationServiceError(
      "EVIDENCE_CANDIDATE_NOT_FOUND",
      "Evidence candidate was not found",
      404
    );
  }
  const existing = state.revocations.find(
    (revocation) => revocation.rootEvidenceId === candidateId
  );
  if (existing !== undefined) {
    if (existing.reason === input.reason) {
      return {
        candidate: await detailInVault(context, candidateId),
        revocation: existing,
        replayed: true
      };
    }
    throw new VerificationServiceError(
      "EVIDENCE_ALREADY_REVOKED",
      "This evidence already has a different immutable revocation reason",
      409
    );
  }
  const verdict = state.verdicts.find(
    (item) => item.candidateId === candidateId
  ) ?? null;
  if (statusFor(root, verdict, state.revocations) !== "accepted") {
    throw new VerificationServiceError(
      "EVIDENCE_NOT_ACCEPTED",
      "Only currently accepted evidence can be revoked",
      409
    );
  }
  const impacts = buildRevocationImpacts(root, state.candidates);
  const record: EvidenceRevocationRecord = {
    schemaVersion: 1,
    id: revocationIdFor({ rootEvidenceId: candidateId, reason: input.reason, impacts }),
    type: "verification-revocation",
    rootEvidenceId: candidateId,
    reason: input.reason,
    revokedAt: new Date().toISOString(),
    impacts
  };
  const created = await createVerificationFile(
    vaultPath,
    `${candidateId.replace(/^evidence-/u, "revocation-")}.md`,
    revocationMarkdown(record)
  );
  if (!created) {
    const raced = (await readVerificationState(vaultPath, context.signal)).revocations.find(
      (revocation) => revocation.rootEvidenceId === candidateId
    );
    if (raced?.reason === input.reason) {
      return {
        candidate: await detailInVault(context, candidateId),
        revocation: raced,
        replayed: true
      };
    }
    throw new VerificationServiceError(
      "EVIDENCE_ALREADY_REVOKED",
      "This evidence already has a different immutable revocation reason",
      409
    );
  }
  return {
    candidate: await detailInVault(context, candidateId),
    revocation: record,
    replayed: false
  };
}

export async function getKnowledgeNodeProjectionInVault(
  context: LibraryOperationContext,
  cardId: string
): Promise<KnowledgeNodeProjection> {
  context.assertCurrent();
  await getCardByIdInVault(context, cardId);
  return buildKnowledgeNodeProjection(
    cardId,
    await readVerificationState(context.path, context.signal)
  );
}
