import { createHash } from "node:crypto";
import { z } from "zod";
import {
  bodyStringSchema,
  evidenceFindingSchema,
  evidenceIdSchema,
  evidenceRelationTypeSchema,
  evidenceVerdictInputSchema,
  evidenceVerifierKindSchema,
  isoUtcMillisecondsSchema,
  linkSafeStringSchema,
  meaningfulBodyStringSchema
} from "../domain/schemas";
import type {
  EvidenceAssistanceLevel,
  EvidenceFinding,
  EvidenceRelationType,
  EvidenceVerdictInput,
  EvidenceVerifierKind
} from "../domain/types";

export const VERDICT_ID_PATTERN = /^verdict-[0-9a-f]{64}$/u;
export const REVOCATION_ID_PATTERN = /^revocation-[0-9a-f]{64}$/u;
export const CANDIDATE_FILENAME_PATTERN = /^evidence-[0-9a-f]{64}\.md$/u;
export const VERDICT_FILENAME_PATTERN = /^verdict-[0-9a-f]{64}\.md$/u;
export const REVOCATION_FILENAME_PATTERN = /^revocation-[0-9a-f]{64}\.md$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const candidateV1Schema = z.object({
  schemaVersion: z.literal(1), id: evidenceIdSchema,
  type: z.literal("verification-evidence"), title: linkSafeStringSchema,
  concept: linkSafeStringSchema, cardId: z.string().uuid(),
  cardPath: meaningfulBodyStringSchema, statement: meaningfulBodyStringSchema,
  proofAttempt: meaningfulBodyStringSchema, predecessorIds: z.array(evidenceIdSchema),
  assistanceLevel: z.enum(["none", "hint", "source", "ai"]),
  evidenceQuality: z.enum(["independent", "assisted"]),
  createdAt: isoUtcMillisecondsSchema
}).strict();

const sourceSnapshotSchema = z.object({
  readingId: z.string().uuid(), relativePath: meaningfulBodyStringSchema,
  snapshotSha256: z.string().regex(SHA256_PATTERN), excerpt: bodyStringSchema,
  locator: meaningfulBodyStringSchema.nullable()
}).strict();

const resolvedRelationSchema = z.object({
  targetEvidenceId: evidenceIdSchema, targetCardId: z.string().uuid(),
  type: evidenceRelationTypeSchema
}).strict();

const candidateV2Schema = z.object({
  schemaVersion: z.literal(2), id: evidenceIdSchema,
  type: z.literal("verification-evidence"), title: linkSafeStringSchema,
  concept: linkSafeStringSchema, cardId: z.string().uuid(),
  cardPath: meaningfulBodyStringSchema, statement: meaningfulBodyStringSchema,
  proofAttempt: meaningfulBodyStringSchema, predecessorIds: z.array(evidenceIdSchema),
  relations: z.array(resolvedRelationSchema),
  assistanceLevel: z.enum(["none", "hint", "source", "ai"]),
  evidenceQuality: z.enum(["independent", "assisted"]),
  contextSnapshot: z.object({
    cardRevision: z.number().int().positive().safe(),
    cardSnapshotSha256: z.string().regex(SHA256_PATTERN),
    sourceSnapshots: z.array(sourceSnapshotSchema).max(1)
  }).strict(), createdAt: isoUtcMillisecondsSchema
}).strict();

export const candidateRecordSchema = z.union([candidateV1Schema, candidateV2Schema]);
const reportSchema = z.object({
  summary: meaningfulBodyStringSchema, criticalErrors: z.array(evidenceFindingSchema),
  gaps: z.array(evidenceFindingSchema)
}).strict();
const verdictV1Schema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(VERDICT_ID_PATTERN),
  type: z.literal("verification-verdict"), title: linkSafeStringSchema,
  concept: linkSafeStringSchema, candidateId: evidenceIdSchema,
  verifierKind: z.enum(["ai-review", "human-review"]), verificationReport: reportSchema,
  verdict: z.enum(["correct", "wrong"]), repairHints: bodyStringSchema,
  verifiedAt: isoUtcMillisecondsSchema
}).strict();
const verdictV2Schema = z.object({
  schemaVersion: z.literal(2), id: z.string().regex(VERDICT_ID_PATTERN),
  type: z.literal("verification-verdict"), title: linkSafeStringSchema,
  concept: linkSafeStringSchema, candidateId: evidenceIdSchema,
  verifierKind: evidenceVerifierKindSchema, verificationReport: reportSchema,
  verdict: z.enum(["correct", "wrong"]), repairHints: bodyStringSchema,
  confirmedByUser: z.boolean(), formalProof: z.literal(false),
  verifiedAt: isoUtcMillisecondsSchema
}).strict();
export const verdictRecordSchema = z.union([verdictV1Schema, verdictV2Schema]);

const revocationImpactSchema = z.object({
  evidenceId: evidenceIdSchema, cardId: z.string().uuid(),
  upstreamEvidenceId: evidenceIdSchema.nullable(), upstreamCardId: z.string().uuid().nullable(),
  path: z.array(evidenceIdSchema).min(1)
}).strict();
export const revocationRecordSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(REVOCATION_ID_PATTERN),
  type: z.literal("verification-revocation"), rootEvidenceId: evidenceIdSchema,
  reason: meaningfulBodyStringSchema, revokedAt: isoUtcMillisecondsSchema,
  impacts: z.array(revocationImpactSchema).min(1)
}).strict();

export type EvidenceQuality = "independent" | "assisted";
export type EvidenceStatus = "awaiting-verification" | "accepted" | "repair-needed" | "revoked" | "affected";
export type KnowledgeTrustState = "unverified" | "supported" | "independently-supported" | "under-review";
export type FrozenSourceSnapshot = { readingId: string; relativePath: string; snapshotSha256: string; excerpt: string; locator: string | null };
export type EvidenceContextSnapshot = { cardRevision: number; cardSnapshotSha256: string; sourceSnapshots: FrozenSourceSnapshot[] };
export type EvidenceRelationRecord = { targetEvidenceId: string; targetCardId: string; type: EvidenceRelationType };
export type EvidenceCandidateV1Record = {
  schemaVersion: 1; id: string; type: "verification-evidence"; title: string;
  concept: string; cardId: string; cardPath: string; statement: string;
  proofAttempt: string; predecessorIds: string[]; assistanceLevel: EvidenceAssistanceLevel;
  evidenceQuality: EvidenceQuality; createdAt: string;
};
export type EvidenceCandidateV2Record = Omit<EvidenceCandidateV1Record, "schemaVersion"> & {
  schemaVersion: 2; relations: EvidenceRelationRecord[]; contextSnapshot: EvidenceContextSnapshot;
};
export type EvidenceCandidateRecord = EvidenceCandidateV1Record | EvidenceCandidateV2Record;
type VerificationReport = { summary: string; criticalErrors: EvidenceFinding[]; gaps: EvidenceFinding[] };
export type EvidenceVerdictV1Record = {
  schemaVersion: 1; id: string; type: "verification-verdict"; title: string;
  concept: string; candidateId: string; verifierKind: "ai-review" | "human-review";
  verificationReport: VerificationReport; verdict: "correct" | "wrong";
  repairHints: string; verifiedAt: string;
};
export type EvidenceVerdictV2Record = Omit<EvidenceVerdictV1Record, "schemaVersion" | "verifierKind"> & {
  schemaVersion: 2; verifierKind: EvidenceVerifierKind; confirmedByUser: boolean; formalProof: false;
};
export type EvidenceVerdictRecord = EvidenceVerdictV1Record | EvidenceVerdictV2Record;
export type RevocationImpact = { evidenceId: string; cardId: string; upstreamEvidenceId: string | null; upstreamCardId: string | null; path: string[] };
export type EvidenceRevocationRecord = { schemaVersion: 1; id: string; type: "verification-revocation"; rootEvidenceId: string; reason: string; revokedAt: string; impacts: RevocationImpact[] };
export type CandidateRevocationImpact = RevocationImpact & { rootEvidenceId: string; reason: string; revokedAt: string };
export type EvidenceCandidateSummary = {
  id: string; title: string; concept: string; cardId: string; statement: string;
  predecessorIds: string[]; relations: EvidenceRelationRecord[];
  assistanceLevel: EvidenceAssistanceLevel; evidenceQuality: EvidenceQuality;
  contextSnapshot: EvidenceContextSnapshot | null; createdAt: string; status: EvidenceStatus;
  qualifiesForMastery: false; verdict: EvidenceVerdictRecord | null;
  revocationImpacts: CandidateRevocationImpact[];
};
export type EvidenceCandidateDetail = EvidenceCandidateSummary & { cardPath: string; proofAttempt: string; relativePath: string; verificationPrompt: string };
export type KnowledgeRelationProjection = { cardId: string; evidenceId: string; relationType: EvidenceRelationType };
export type KnowledgeNodeProjection = { cardId: string; trustState: KnowledgeTrustState; activeEvidenceIds: string[]; affectedEvidenceIds: string[]; prerequisites: KnowledgeRelationProjection[]; usedBy: KnowledgeRelationProjection[]; revocationImpacts: CandidateRevocationImpact[] };
export type VerificationDiagnostic = {
  errorId: string;
  file: string;
  message: string;
};
export type VerificationState = {
  candidates: EvidenceCandidateRecord[];
  verdicts: EvidenceVerdictRecord[];
  revocations: EvidenceRevocationRecord[];
  diagnostics: VerificationDiagnostic[];
};

export class VerificationServiceError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message); this.name = "VerificationServiceError"; this.code = code; this.status = status;
  }
}
export function invalidEvidenceFile(message: string): VerificationServiceError {
  return new VerificationServiceError("INVALID_EVIDENCE_FILE", message, 409);
}
export function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function canonicalJson(value: unknown): string { return JSON.stringify(value); }
function candidateV1IdFor(input: Pick<EvidenceCandidateV1Record, "cardId" | "statement" | "proofAttempt" | "predecessorIds" | "assistanceLevel">): string {
  return `evidence-${sha256(canonicalJson({ cardId: input.cardId, statement: input.statement, proofAttempt: input.proofAttempt, predecessorIds: input.predecessorIds, assistanceLevel: input.assistanceLevel }))}`;
}
export function candidateV2IdFor(input: { cardId: string; statement: string; proofAttempt: string; predecessorIds: string[]; relations: EvidenceRelationRecord[]; assistanceLevel: EvidenceAssistanceLevel; contextSnapshot: EvidenceContextSnapshot }): string {
  return `evidence-${sha256(canonicalJson(input))}`;
}
function legacyVerdictIdFor(candidateId: string, input: Omit<EvidenceVerdictInput, "confirmed">): string {
  return `verdict-${sha256(canonicalJson({ candidateId, ...input }))}`;
}
export function verdictV2IdFor(candidateId: string, input: EvidenceVerdictInput): string {
  return `verdict-${sha256(canonicalJson({ candidateId, ...input }))}`;
}
export function revocationIdFor(input: { rootEvidenceId: string; reason: string; impacts: RevocationImpact[] }): string {
  return `revocation-${sha256(canonicalJson(input))}`;
}

export function validateCandidateRecord(record: EvidenceCandidateRecord): EvidenceCandidateRecord {
  if (new Set(record.predecessorIds).size !== record.predecessorIds.length) throw invalidEvidenceFile("Evidence predecessor IDs must be unique");
  const quality = record.assistanceLevel === "none" ? "independent" : "assisted";
  if (record.evidenceQuality !== quality) throw invalidEvidenceFile("Evidence quality does not match assistance level");
  if (record.schemaVersion === 1) {
    if ([...record.predecessorIds].sort().some((id, index) => id !== record.predecessorIds[index])) throw invalidEvidenceFile("Version 1 predecessors must be sorted");
    if (record.id !== candidateV1IdFor(record)) throw invalidEvidenceFile("Evidence candidate content does not match its content-addressed ID");
  } else {
    if (record.relations.length !== record.predecessorIds.length || record.relations.some((relation, index) => relation.targetEvidenceId !== record.predecessorIds[index])) throw invalidEvidenceFile("Version 2 relations must cover predecessors in submitted order");
    if (record.id !== candidateV2IdFor({
      cardId: record.cardId,
      statement: record.statement,
      proofAttempt: record.proofAttempt,
      predecessorIds: record.predecessorIds,
      relations: record.relations,
      assistanceLevel: record.assistanceLevel,
      contextSnapshot: record.contextSnapshot
    })) {
      throw invalidEvidenceFile("Evidence candidate content does not match its content-addressed ID");
    }
  }
  return record;
}
export function verdictInputFromRecord(record: EvidenceVerdictRecord): EvidenceVerdictInput {
  return evidenceVerdictInputSchema.parse({ verifierKind: record.verifierKind, verificationReport: record.verificationReport, verdict: record.verdict, repairHints: record.repairHints, confirmed: record.schemaVersion === 2 ? record.confirmedByUser : false });
}
export function validateVerdictRecord(record: EvidenceVerdictRecord): EvidenceVerdictRecord {
  const input = verdictInputFromRecord(record);
  const expected = record.schemaVersion === 1
    ? legacyVerdictIdFor(record.candidateId, { verifierKind: record.verifierKind, verificationReport: record.verificationReport, verdict: record.verdict, repairHints: record.repairHints })
    : verdictV2IdFor(record.candidateId, input);
  if (record.id !== expected) throw invalidEvidenceFile("Evidence verdict content does not match its content-addressed ID");
  return record;
}
export function validateRevocationRecord(record: EvidenceRevocationRecord): EvidenceRevocationRecord {
  if (record.id !== revocationIdFor({
    rootEvidenceId: record.rootEvidenceId,
    reason: record.reason,
    impacts: record.impacts
  })) {
    throw invalidEvidenceFile("Evidence revocation content does not match its content-addressed ID");
  }
  const seen = new Set<string>();
  for (const impact of record.impacts) {
    if (seen.has(impact.evidenceId) || impact.path[0] !== record.rootEvidenceId || impact.path.at(-1) !== impact.evidenceId) throw invalidEvidenceFile("Evidence revocation impact paths are invalid");
    seen.add(impact.evidenceId);
  }
  if (!seen.has(record.rootEvidenceId)) throw invalidEvidenceFile("Evidence revocation must include its root");
  return record;
}
export function sameVerdictInput(left: EvidenceVerdictInput, right: EvidenceVerdictInput): boolean { return canonicalJson(left) === canonicalJson(right); }
export function candidateImpacts(candidateId: string, records: EvidenceRevocationRecord[]): CandidateRevocationImpact[] {
  return records.flatMap((record) => record.impacts.filter((impact) => impact.evidenceId === candidateId).map((impact) => ({ ...impact, rootEvidenceId: record.rootEvidenceId, reason: record.reason, revokedAt: record.revokedAt })));
}
export function statusFor(record: EvidenceCandidateRecord, verdict: EvidenceVerdictRecord | null, revocations: EvidenceRevocationRecord[]): EvidenceStatus {
  const impacts = candidateImpacts(record.id, revocations);
  if (impacts.some((impact) => impact.rootEvidenceId === record.id)) return "revoked";
  if (impacts.length > 0) return "affected";
  if (verdict === null) return "awaiting-verification";
  return verdict.verdict === "correct" ? "accepted" : "repair-needed";
}
export function relationRecords(record: EvidenceCandidateRecord, candidatesById: Map<string, EvidenceCandidateRecord>): EvidenceRelationRecord[] {
  if (record.schemaVersion === 2) return record.relations;
  return record.predecessorIds.map((targetEvidenceId) => {
    const predecessor = candidatesById.get(targetEvidenceId);
    if (predecessor === undefined) throw invalidEvidenceFile("Evidence predecessor record is missing");
    return { targetEvidenceId, targetCardId: predecessor.cardId, type: "requires" };
  });
}
