export {
  createEvidenceCandidate,
  getEvidenceCandidate,
  listEvidenceCandidates
} from "./verification-candidate";
export { recordEvidenceVerdict } from "./verification-verdict";
export {
  getKnowledgeNodeProjection,
  revokeEvidenceCandidate
} from "./verification-revocation";
export { VerificationServiceError } from "./verification-domain";
export type {
  EvidenceCandidateDetail,
  EvidenceCandidateSummary,
  EvidenceRevocationRecord,
  EvidenceVerdictRecord,
  KnowledgeNodeProjection
} from "./verification-domain";
