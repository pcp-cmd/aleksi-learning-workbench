import { evidenceVerdictInputSchema } from "../domain/schemas";
import type { EvidenceVerdictInput } from "../domain/types";
import {
  VerificationServiceError,
  sameVerdictInput,
  statusFor,
  verdictInputFromRecord,
  verdictV2IdFor
} from "./verification-domain";
import type {
  EvidenceCandidateDetail,
  EvidenceVerdictRecord,
  EvidenceVerdictV2Record
} from "./verification-domain";
import { verdictMarkdown } from "./verification-format";
import { getEvidenceCandidateInVault } from "./verification-candidate";
import {
  activeVaultPath,
  candidateById,
  createVerificationFile,
  readVerificationState
} from "./verification-store";

export async function recordEvidenceVerdict(
  candidateId: string,
  rawInput: EvidenceVerdictInput
): Promise<{
  candidate: EvidenceCandidateDetail;
  verdict: EvidenceVerdictRecord;
  replayed: boolean;
}> {
  const input = evidenceVerdictInputSchema.parse(rawInput);
  const vaultPath = await activeVaultPath();
  const found = await candidateById(vaultPath, candidateId);
  if (found === null) {
    throw new VerificationServiceError(
      "EVIDENCE_CANDIDATE_NOT_FOUND",
      "Evidence candidate was not found",
      404
    );
  }
  const state = await readVerificationState(vaultPath);
  const existing = state.verdicts.filter(
    (verdict) => verdict.candidateId === candidateId
  );
  const replay = existing.find((verdict) =>
    sameVerdictInput(verdictInputFromRecord(verdict), input)
  );
  if (replay !== undefined) {
    return {
      candidate: await getEvidenceCandidateInVault(vaultPath, candidateId),
      verdict: replay,
      replayed: true
    };
  }
  if (existing.length > 0) {
    throw new VerificationServiceError(
      "EVIDENCE_VERDICT_ALREADY_RECORDED",
      "This immutable candidate already has a different verdict",
      409
    );
  }
  const currentStatus = statusFor(found.record, null, state.revocations);
  if (currentStatus === "revoked" || currentStatus === "affected") {
    throw new VerificationServiceError(
      "EVIDENCE_UNDER_REVIEW",
      "A revoked or affected candidate cannot receive a new verdict",
      409
    );
  }
  const record: EvidenceVerdictV2Record = {
    schemaVersion: 2,
    id: verdictV2IdFor(candidateId, input),
    type: "verification-verdict",
    title: `验证结论：${found.record.title}`,
    concept: found.record.concept,
    candidateId,
    verifierKind: input.verifierKind,
    verificationReport: input.verificationReport,
    verdict: input.verdict,
    repairHints: input.repairHints,
    confirmedByUser: input.confirmed,
    formalProof: false,
    verifiedAt: new Date().toISOString()
  };
  const created = await createVerificationFile(
    vaultPath,
    `${candidateId.replace(/^evidence-/u, "verdict-")}.md`,
    verdictMarkdown(record)
  );
  if (!created) {
    const raced = (await readVerificationState(vaultPath)).verdicts.find(
      (verdict) => verdict.candidateId === candidateId
    );
    if (raced !== undefined && sameVerdictInput(
      verdictInputFromRecord(raced), input
    )) {
      return {
        candidate: await getEvidenceCandidateInVault(vaultPath, candidateId),
        verdict: raced,
        replayed: true
      };
    }
    throw new VerificationServiceError(
      "EVIDENCE_VERDICT_ALREADY_RECORDED",
      "This immutable candidate already has a different verdict",
      409
    );
  }
  return {
    candidate: await getEvidenceCandidateInVault(vaultPath, candidateId),
    verdict: record,
    replayed: false
  };
}
