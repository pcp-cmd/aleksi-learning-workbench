import type { z } from "zod";
import type {
  blockTypeSchema,
  cardSchemaVersionSchema,
  compatibleCardMetadataSchema,
  cardCreateInputSchema,
  cardRecordSchema,
  cardTypeSchema,
  codexTaskCreateInputSchema,
  boundaryCardRecordSchema,
  boundaryCardUpdateInputSchema,
  conceptCardRecordSchema,
  conceptCardUpdateInputSchema,
  counterexampleCardRecordSchema,
  counterexampleCardUpdateInputSchema,
  definitionCardRecordSchema,
  definitionCardUpdateInputSchema,
  diagnosisCreateInputSchema,
  evidenceAssistanceLevelSchema,
  evidenceCandidateCreateInputSchema,
  evidenceFindingSchema,
  evidenceRelationInputSchema,
  evidenceRelationTypeSchema,
  evidenceRevocationInputSchema,
  evidenceVerdictInputSchema,
  evidenceVerifierKindSchema,
  exampleCardRecordSchema,
  exampleCardUpdateInputSchema,
  mistakeCardRecordSchema,
  mistakeCardUpdateInputSchema,
  persistedMasterySchema,
  processCardRecordSchema,
  processCardUpdateInputSchema,
  proofCardRecordSchema,
  proofCardUpdateInputSchema,
  reviewAssistanceLevelSchema,
  reviewAttemptInputSchema,
  reviewDiagnosisDraftSchema,
  reviewFeedbackSchema,
  reviewResultInputSchema,
  revisionEntrySchema
} from "./schemas";

export type CardType = z.infer<typeof cardTypeSchema>;
export type CardSchemaVersion = z.infer<typeof cardSchemaVersionSchema>;
export type CompatibleCardMetadata = z.infer<
  typeof compatibleCardMetadataSchema
>;
export type BlockType = z.infer<typeof blockTypeSchema>;
export type PersistedMastery = z.infer<typeof persistedMasterySchema>;
export type RevisionEntry = z.infer<typeof revisionEntrySchema>;
export type CardCreateInput = z.infer<typeof cardCreateInputSchema>;
export type ReviewFeedback = z.infer<typeof reviewFeedbackSchema>;
export type ReviewAssistanceLevel = z.infer<
  typeof reviewAssistanceLevelSchema
>;
export type ReviewAttemptInput = z.infer<typeof reviewAttemptInputSchema>;
export type ReviewDiagnosisDraft = z.infer<
  typeof reviewDiagnosisDraftSchema
>;
export type ReviewResultInput = z.infer<typeof reviewResultInputSchema>;
export type EvidenceAssistanceLevel = z.infer<
  typeof evidenceAssistanceLevelSchema
>;
export type EvidenceVerifierKind = z.infer<typeof evidenceVerifierKindSchema>;
export type EvidenceFinding = z.infer<typeof evidenceFindingSchema>;
export type EvidenceRelationType = z.infer<typeof evidenceRelationTypeSchema>;
export type EvidenceRelationInput = z.infer<typeof evidenceRelationInputSchema>;
export type EvidenceCandidateCreateInput = z.infer<
  typeof evidenceCandidateCreateInputSchema
>;
export type EvidenceVerdictInput = z.infer<
  typeof evidenceVerdictInputSchema
>;
export type EvidenceRevocationInput = z.infer<
  typeof evidenceRevocationInputSchema
>;
export type DiagnosisCreateInput = z.infer<
  typeof diagnosisCreateInputSchema
>;
export type CodexTaskCreateInput = z.infer<
  typeof codexTaskCreateInputSchema
>;

export type DefinitionCardUpdateInput = z.infer<
  typeof definitionCardUpdateInputSchema
>;
export type ConceptCardUpdateInput = z.infer<
  typeof conceptCardUpdateInputSchema
>;
export type ExampleCardUpdateInput = z.infer<
  typeof exampleCardUpdateInputSchema
>;
export type BoundaryCardUpdateInput = z.infer<
  typeof boundaryCardUpdateInputSchema
>;
export type CounterexampleCardUpdateInput = z.infer<
  typeof counterexampleCardUpdateInputSchema
>;
export type ProcessCardUpdateInput = z.infer<
  typeof processCardUpdateInputSchema
>;
export type MistakeCardUpdateInput = z.infer<
  typeof mistakeCardUpdateInputSchema
>;
export type ProofCardUpdateInput = z.infer<
  typeof proofCardUpdateInputSchema
>;

export type CardUpdateInputByType = {
  concept: ConceptCardUpdateInput;
  definition: DefinitionCardUpdateInput;
  example: ExampleCardUpdateInput;
  boundary: BoundaryCardUpdateInput;
  counterexample: CounterexampleCardUpdateInput;
  process: ProcessCardUpdateInput;
  mistake: MistakeCardUpdateInput;
  proof: ProofCardUpdateInput;
};

export type CardUpdateInput =
  CardUpdateInputByType[keyof CardUpdateInputByType];

export type DefinitionCardRecord = z.infer<
  typeof definitionCardRecordSchema
>;
export type ConceptCardRecord = z.infer<typeof conceptCardRecordSchema>;
export type ExampleCardRecord = z.infer<typeof exampleCardRecordSchema>;
export type BoundaryCardRecord = z.infer<typeof boundaryCardRecordSchema>;
export type CounterexampleCardRecord = z.infer<
  typeof counterexampleCardRecordSchema
>;
export type ProcessCardRecord = z.infer<typeof processCardRecordSchema>;
export type MistakeCardRecord = z.infer<typeof mistakeCardRecordSchema>;
export type ProofCardRecord = z.infer<typeof proofCardRecordSchema>;
export type CardRecord = z.infer<typeof cardRecordSchema>;
