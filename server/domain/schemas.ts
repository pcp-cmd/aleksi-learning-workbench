import { z } from "zod";
import { CARD_TYPES } from "../../shared/card-types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_UTC_MILLISECONDS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNSAFE_LINK_PATTERN = /\||\[\[|\]\]|\r|\n|\/|\\/u;
const REVIEW_ID_PATTERN = /^review-[0-9a-f]{64}$/;
const EVIDENCE_ID_PATTERN = /^evidence-[0-9a-f]{64}$/;
const REVISION_REVIEW_METADATA_PATTERN =
  /^\[review:([^\]\r\n]+)\] (.+)$/;

const RESERVED_CARD_METADATA_KEYS = new Set([
  "schemaVersion",
  "compatibleMetadata",
  "id",
  "type",
  "title",
  "concept",
  "relatedConcepts",
  "sourceReading",
  "excerpt",
  "understanding",
  "blockType",
  "nextAction",
  "mastery",
  "createdAt",
  "nextReview",
  "lastAppliedReviewId",
  "lastAppliedReviewSequence",
  "reviewAppliedAt",
  "reviewOverrideAt",
  "pendingReviewId",
  "revisionLog",
  ...[
    "formalDefinition",
    "plainExplanation",
    "quantifierStructure",
    "commonMisunderstandings",
    "formalExplanation",
    "myUnderstanding",
    "commonMisunderstanding",
    "usageContext",
    "exampleContent",
    "whyItFits",
    "trainingPurpose",
    "counterexampleContent",
    "brokenCondition",
    "whyItIsNot",
    "confusingObjects",
    "similarity",
    "keyDifference",
    "judgementRule",
    "task",
    "steps",
    "keyTurn",
    "pitfall",
    "mistake",
    "originalThinking",
    "realCause",
    "correctMethod",
    "recognitionSignal",
    "proposition",
    "firstAttempt",
    "keyMove",
    "proofOutline",
    "failureReason"
  ]
]);

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every((item) => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }
  if (typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Object.entries(value).every(
    ([key, item]) => isWellFormedString(key) && isJsonValue(item, seen)
  );
  seen.delete(value);
  return valid;
}

export function isWellFormedString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (
        !Number.isFinite(nextCodeUnit) ||
        nextCodeUnit < 0xdc00 ||
        nextCodeUnit > 0xdfff
      ) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }

  return true;
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isIsoUtcMilliseconds(value: string): boolean {
  if (!ISO_UTC_MILLISECONDS_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

export const cardTypeSchema = z.enum(CARD_TYPES);

export const blockTypeSchema = z.enum([
  "definition",
  "example",
  "counterexample",
  "proof-search",
  "technical",
  "expression",
  "transfer",
  "emotion"
]);

export const persistedMasterySchema = z.enum([
  "learning",
  "mastered",
  "rebuild",
  "archived"
]);

export const manualMasterySchema = z.enum([
  "learning",
  "mastered",
  "rebuild"
]);

export const reviewFeedbackSchema = z.enum([
  "forgot",
  "fuzzy",
  "known",
  "fluent"
]);

export const evidenceAssistanceLevelSchema = z.enum([
  "none",
  "hint",
  "source",
  "ai"
]);

export const evidenceVerifierKindSchema = z.enum([
  "ai-review",
  "human-review",
  "gpt-plus-import"
]);

export const wellFormedStringSchema = z.string().refine(isWellFormedString, {
  message: "String must be well-formed UTF-16"
});

export const dateSchema = wellFormedStringSchema.refine(isCalendarDate, {
  message: "Expected a valid YYYY-MM-DD date"
});

export const isoUtcMillisecondsSchema = wellFormedStringSchema.refine(
  isIsoUtcMilliseconds,
  {
    message: "Expected an ISO UTC datetime with milliseconds"
  }
);

export const linkSafeStringSchema = wellFormedStringSchema
  .transform((value) => value.trim().normalize("NFC"))
  .superRefine((value, context) => {
    if (value.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 1,
        inclusive: true,
        type: "string",
        message: "Link-safe values must be nonempty"
      });
    }

    if (UNSAFE_LINK_PATTERN.test(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Link-safe values contain a reserved sequence"
      });
    }
  });

export const bodyStringSchema = wellFormedStringSchema
  .refine((value) => !value.includes("\u0000"), {
    message: "Body strings cannot contain U+0000"
  })
  .transform((value) => value.replace(/\r\n?/g, "\n"));

export const nonEmptyBodyStringSchema = bodyStringSchema.refine(
  (value) => value.length > 0,
  {
    message: "Body string must be nonempty"
  }
);

export const relatedConceptsSchema = z
  .array(linkSafeStringSchema)
  .superRefine((values, context) => {
    const seen = new Set<string>();

    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Related concepts must be unique after normalization",
          path: [index]
        });
      }
      seen.add(value);
    });
  });

const revisionNoteSchema = wellFormedStringSchema
  .refine((value) => value.length > 0, {
    message: "Revision notes must be nonempty"
  })
  .refine(
    (value) =>
      !value.includes("\n") &&
      !value.includes("\r") &&
      !value.includes("\u0000"),
    {
      message: "Revision notes must be single-line and cannot contain U+0000"
    }
  );

export const reviewIdSchema = wellFormedStringSchema.refine(
  (value) => REVIEW_ID_PATTERN.test(value),
  {
    message: "Review ID must be review- followed by 64 lowercase hex digits"
  }
);

export const meaningfulBodyStringSchema = bodyStringSchema.refine(
  (value) => value.trim().length > 0,
  {
    message: "Body string must contain non-whitespace content"
  }
);

export const evidenceIdSchema = wellFormedStringSchema.refine(
  (value) => EVIDENCE_ID_PATTERN.test(value),
  {
    message: "Evidence ID must be evidence- followed by 64 lowercase hex digits"
  }
);

export function parseRevisionNoteMetadata(
  value: string
): { reviewId: string; note: string } | null {
  const match = REVISION_REVIEW_METADATA_PATTERN.exec(value);

  if (match === null || !REVIEW_ID_PATTERN.test(match[1])) {
    return null;
  }

  return {
    reviewId: match[1],
    note: match[2]
  };
}

export const revisionEntrySchema = z
  .object({
    at: dateSchema,
    note: revisionNoteSchema,
    reviewId: reviewIdSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.reviewId === null &&
      parseRevisionNoteMetadata(value.note) !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Revision notes without a review ID cannot duplicate review metadata",
        path: ["note"]
      });
    }
  });

const sourceReadingIdSchema = wellFormedStringSchema.refine(
  (value) => value.length > 0,
  {
    message: "Source reading ID must be nonempty"
  }
);
const sourceReadingSchema = wellFormedStringSchema.refine(
  (value) => value.length > 0,
  {
    message: "Source reading path must be nonempty"
  }
);

const definitionPayloadShape = {
  formalDefinition: nonEmptyBodyStringSchema,
  plainExplanation: nonEmptyBodyStringSchema,
  quantifierStructure: bodyStringSchema,
  commonMisunderstandings: bodyStringSchema
};

const conceptPayloadShape = {
  formalExplanation: nonEmptyBodyStringSchema,
  myUnderstanding: nonEmptyBodyStringSchema,
  commonMisunderstanding: bodyStringSchema,
  usageContext: bodyStringSchema
};

const examplePayloadShape = {
  exampleContent: nonEmptyBodyStringSchema,
  whyItFits: nonEmptyBodyStringSchema,
  trainingPurpose: bodyStringSchema
};

const counterexamplePayloadShape = {
  counterexampleContent: nonEmptyBodyStringSchema,
  brokenCondition: nonEmptyBodyStringSchema,
  whyItIsNot: nonEmptyBodyStringSchema
};

const boundaryPayloadShape = {
  confusingObjects: nonEmptyBodyStringSchema,
  similarity: nonEmptyBodyStringSchema,
  keyDifference: nonEmptyBodyStringSchema,
  judgementRule: nonEmptyBodyStringSchema
};

const processPayloadShape = {
  task: nonEmptyBodyStringSchema,
  steps: nonEmptyBodyStringSchema,
  keyTurn: nonEmptyBodyStringSchema,
  pitfall: bodyStringSchema,
  usageContext: bodyStringSchema
};

const mistakePayloadShape = {
  mistake: nonEmptyBodyStringSchema,
  originalThinking: nonEmptyBodyStringSchema,
  realCause: nonEmptyBodyStringSchema,
  correctMethod: nonEmptyBodyStringSchema,
  recognitionSignal: bodyStringSchema
};

const proofPayloadShape = {
  proposition: nonEmptyBodyStringSchema,
  firstAttempt: bodyStringSchema,
  keyMove: nonEmptyBodyStringSchema,
  proofOutline: nonEmptyBodyStringSchema,
  failureReason: bodyStringSchema
};

const createCommonShape = {
  title: linkSafeStringSchema,
  concept: linkSafeStringSchema,
  relatedConcepts: relatedConceptsSchema.default([]),
  sourceReadingId: sourceReadingIdSchema,
  excerpt: bodyStringSchema,
  understanding: bodyStringSchema.default(""),
  blockType: blockTypeSchema.nullable().default(null),
  nextAction: bodyStringSchema.default("")
};

export const definitionCardCreateInputSchema = z
  .object({
    ...createCommonShape,
    type: z.literal("definition"),
    ...definitionPayloadShape
  })
  .strict();

export const conceptCardCreateInputSchema = z
  .object({
    ...createCommonShape,
    type: z.literal("concept"),
    ...conceptPayloadShape
  })
  .strict();

export const exampleCardCreateInputSchema = z
  .object({
    ...createCommonShape,
    type: z.literal("example"),
    ...examplePayloadShape
  })
  .strict();

export const counterexampleCardCreateInputSchema = z
  .object({
    ...createCommonShape,
    type: z.literal("counterexample"),
    ...counterexamplePayloadShape
  })
  .strict();

export const boundaryCardCreateInputSchema = z
  .object({
    ...createCommonShape,
    type: z.literal("boundary"),
    ...boundaryPayloadShape
  })
  .strict();

export const processCardCreateInputSchema = z
  .object({
    ...createCommonShape,
    type: z.literal("process"),
    ...processPayloadShape
  })
  .strict();

export const mistakeCardCreateInputSchema = z
  .object({
    ...createCommonShape,
    type: z.literal("mistake"),
    ...mistakePayloadShape
  })
  .strict();

export const proofCardCreateInputSchema = z
  .object({
    ...createCommonShape,
    type: z.literal("proof"),
    ...proofPayloadShape
  })
  .strict();

export const cardCreateInputSchemas = {
  concept: conceptCardCreateInputSchema,
  definition: definitionCardCreateInputSchema,
  example: exampleCardCreateInputSchema,
  boundary: boundaryCardCreateInputSchema,
  counterexample: counterexampleCardCreateInputSchema,
  process: processCardCreateInputSchema,
  mistake: mistakeCardCreateInputSchema,
  proof: proofCardCreateInputSchema
} as const;

export const cardCreateInputSchema = z.discriminatedUnion("type", [
  conceptCardCreateInputSchema,
  definitionCardCreateInputSchema,
  exampleCardCreateInputSchema,
  boundaryCardCreateInputSchema,
  counterexampleCardCreateInputSchema,
  processCardCreateInputSchema,
  mistakeCardCreateInputSchema,
  proofCardCreateInputSchema
]);

const updateCommonShape = {
  title: linkSafeStringSchema,
  concept: linkSafeStringSchema,
  relatedConcepts: relatedConceptsSchema,
  sourceReadingId: sourceReadingIdSchema,
  excerpt: bodyStringSchema,
  understanding: bodyStringSchema,
  blockType: blockTypeSchema.nullable(),
  nextAction: bodyStringSchema,
  mastery: manualMasterySchema
};

export const definitionCardUpdateInputSchema = z
  .object({
    ...updateCommonShape,
    ...definitionPayloadShape
  })
  .strict();

export const conceptCardUpdateInputSchema = z
  .object({
    ...updateCommonShape,
    ...conceptPayloadShape
  })
  .strict();

export const exampleCardUpdateInputSchema = z
  .object({
    ...updateCommonShape,
    ...examplePayloadShape
  })
  .strict();

export const counterexampleCardUpdateInputSchema = z
  .object({
    ...updateCommonShape,
    ...counterexamplePayloadShape
  })
  .strict();

export const boundaryCardUpdateInputSchema = z
  .object({
    ...updateCommonShape,
    ...boundaryPayloadShape
  })
  .strict();

export const processCardUpdateInputSchema = z
  .object({
    ...updateCommonShape,
    ...processPayloadShape
  })
  .strict();

export const mistakeCardUpdateInputSchema = z
  .object({
    ...updateCommonShape,
    ...mistakePayloadShape
  })
  .strict();

export const proofCardUpdateInputSchema = z
  .object({
    ...updateCommonShape,
    ...proofPayloadShape
  })
  .strict();

export const cardUpdateInputSchemas = {
  concept: conceptCardUpdateInputSchema,
  definition: definitionCardUpdateInputSchema,
  example: exampleCardUpdateInputSchema,
  boundary: boundaryCardUpdateInputSchema,
  counterexample: counterexampleCardUpdateInputSchema,
  process: processCardUpdateInputSchema,
  mistake: mistakeCardUpdateInputSchema,
  proof: proofCardUpdateInputSchema
} as const;

type SchemaCardType = z.infer<typeof cardTypeSchema>;

export function parseCardUpdateInput<T extends SchemaCardType>(
  type: T,
  input: unknown
): z.infer<(typeof cardUpdateInputSchemas)[T]> {
  return cardUpdateInputSchemas[type].parse(input) as z.infer<
    (typeof cardUpdateInputSchemas)[T]
  >;
}

export const cardSchemaVersionSchema = z.union([
  z.literal(1),
  z.literal(2)
]);

export const compatibleCardMetadataSchema = z
  .record(z.unknown())
  .default({})
  .superRefine((metadata, context) => {
    for (const [key, value] of Object.entries(metadata)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Compatible metadata keys must be stable ASCII identifiers",
          path: [key]
        });
      }
      if (RESERVED_CARD_METADATA_KEYS.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Compatible metadata cannot override a reserved card field",
          path: [key]
        });
      }
      if (!isJsonValue(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Compatible metadata values must be finite JSON values",
          path: [key]
        });
      }
    }
  });

const recordCommonShape = {
  schemaVersion: cardSchemaVersionSchema.default(1),
  compatibleMetadata: compatibleCardMetadataSchema,
  id: z.string().uuid(),
  title: linkSafeStringSchema,
  concept: linkSafeStringSchema,
  relatedConcepts: relatedConceptsSchema,
  sourceReading: sourceReadingSchema,
  excerpt: bodyStringSchema,
  understanding: bodyStringSchema,
  blockType: blockTypeSchema.nullable(),
  nextAction: bodyStringSchema,
  mastery: persistedMasterySchema,
  createdAt: isoUtcMillisecondsSchema,
  nextReview: dateSchema,
  lastAppliedReviewId: reviewIdSchema.nullable(),
  lastAppliedReviewSequence: z.number().int().positive().safe().nullable(),
  reviewAppliedAt: isoUtcMillisecondsSchema.nullable(),
  reviewOverrideAt: isoUtcMillisecondsSchema.nullable(),
  pendingReviewId: reviewIdSchema.nullable(),
  revisionLog: z.array(revisionEntrySchema).min(1)
};

function enforceAppliedReviewProvenance(
  value: {
    lastAppliedReviewId: string | null;
    lastAppliedReviewSequence: number | null;
    reviewAppliedAt: string | null;
  },
  context: z.RefinementCtx
): void {
  const values = [
    value.lastAppliedReviewId,
    value.lastAppliedReviewSequence,
    value.reviewAppliedAt
  ];
  const nullCount = values.filter((item) => item === null).length;

  if (nullCount !== 0 && nullCount !== values.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Applied review id, sequence, and timestamp must be all null or all present",
      path: ["lastAppliedReviewId"]
    });
  }
}

export const definitionCardRecordSchema = z
  .object({
    ...recordCommonShape,
    type: z.literal("definition"),
    ...definitionPayloadShape
  })
  .strict()
  .superRefine(enforceAppliedReviewProvenance);

export const conceptCardRecordSchema = z
  .object({
    ...recordCommonShape,
    type: z.literal("concept"),
    ...conceptPayloadShape
  })
  .strict()
  .superRefine(enforceAppliedReviewProvenance);

export const exampleCardRecordSchema = z
  .object({
    ...recordCommonShape,
    type: z.literal("example"),
    ...examplePayloadShape
  })
  .strict()
  .superRefine(enforceAppliedReviewProvenance);

export const counterexampleCardRecordSchema = z
  .object({
    ...recordCommonShape,
    type: z.literal("counterexample"),
    ...counterexamplePayloadShape
  })
  .strict()
  .superRefine(enforceAppliedReviewProvenance);

export const boundaryCardRecordSchema = z
  .object({
    ...recordCommonShape,
    type: z.literal("boundary"),
    ...boundaryPayloadShape
  })
  .strict()
  .superRefine(enforceAppliedReviewProvenance);

export const processCardRecordSchema = z
  .object({
    ...recordCommonShape,
    type: z.literal("process"),
    ...processPayloadShape
  })
  .strict()
  .superRefine(enforceAppliedReviewProvenance);

export const mistakeCardRecordSchema = z
  .object({
    ...recordCommonShape,
    type: z.literal("mistake"),
    ...mistakePayloadShape
  })
  .strict()
  .superRefine(enforceAppliedReviewProvenance);

export const proofCardRecordSchema = z
  .object({
    ...recordCommonShape,
    type: z.literal("proof"),
    ...proofPayloadShape
  })
  .strict()
  .superRefine(enforceAppliedReviewProvenance);

export const cardRecordSchemas = {
  concept: conceptCardRecordSchema,
  definition: definitionCardRecordSchema,
  example: exampleCardRecordSchema,
  boundary: boundaryCardRecordSchema,
  counterexample: counterexampleCardRecordSchema,
  process: processCardRecordSchema,
  mistake: mistakeCardRecordSchema,
  proof: proofCardRecordSchema
} as const;

export const cardRecordSchema = z.union([
  conceptCardRecordSchema,
  definitionCardRecordSchema,
  exampleCardRecordSchema,
  boundaryCardRecordSchema,
  counterexampleCardRecordSchema,
  processCardRecordSchema,
  mistakeCardRecordSchema,
  proofCardRecordSchema
]);

const relatedCardIdSchema = wellFormedStringSchema.refine(
  (value) => value.length > 0,
  {
    message: "Related card ID must be nonempty"
  }
);

export const diagnosisCreateInputSchema = z
  .object({
    concept: linkSafeStringSchema,
    relatedCardId: relatedCardIdSchema.optional(),
    blockType: blockTypeSchema,
    manifestation: nonEmptyBodyStringSchema,
    assumedProblem: nonEmptyBodyStringSchema,
    actualCause: nonEmptyBodyStringSchema,
    nextMinimumAction: nonEmptyBodyStringSchema,
    targetCardType: cardTypeSchema
  })
  .strict();

export const codexTaskCreateInputSchema = z
  .object({
    concept: linkSafeStringSchema,
    sourceReadingId: sourceReadingIdSchema.optional(),
    relatedCardId: relatedCardIdSchema.optional(),
    currentMaterial: nonEmptyBodyStringSchema,
    understanding: bodyStringSchema.default(""),
    blockType: blockTypeSchema
  })
  .strict();

const idempotencyKeySchema = wellFormedStringSchema
  .transform((value) => value.toLowerCase())
  .refine(
    (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        value
      ),
    {
      message: "Idempotency key must be a UUID v4"
    }
  );

export const reviewAssistanceLevelSchema = z.enum([
  "none",
  "hint",
  "source",
  "ai"
]);

export const reviewAttemptInputSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    answer: bodyStringSchema,
    declaredDontKnow: z.boolean(),
    confidenceBeforeReveal: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4)
    ]),
    durationMs: z.number().int().min(0).max(86_400_000),
    assistanceLevel: reviewAssistanceLevelSchema
  })
  .strict()
  .superRefine((value, context) => {
    const hasAnswer = value.answer.trim().length > 0;
    if (value.declaredDontKnow === hasAnswer) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answer"],
        message:
          "Provide an answer or declare that you do not know, but not both"
      });
    }
  });

export const reviewDiagnosisDraftSchema = z
  .object({
    assumedProblem: nonEmptyBodyStringSchema,
    causeHypothesis: nonEmptyBodyStringSchema,
    nextMinimumAction: nonEmptyBodyStringSchema,
    targetCardType: cardTypeSchema
  })
  .strict();

export const reviewResultInputSchema = z
  .object({
    attemptId: reviewIdSchema,
    feedback: reviewFeedbackSchema,
    blockType: blockTypeSchema.nullable(),
    selfCorrection: bodyStringSchema,
    diagnosisDraft: reviewDiagnosisDraftSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    const needsDiagnosis =
      value.feedback === "forgot" || value.feedback === "fuzzy";
    if (needsDiagnosis && value.selfCorrection.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selfCorrection"],
        message: "Weak reviews require a non-empty self-correction"
      });
    }
    if (needsDiagnosis !== (value.diagnosisDraft !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["diagnosisDraft"],
        message: needsDiagnosis
          ? "Forgot and fuzzy reviews require a diagnosis draft"
          : "Known and fluent reviews must not create a diagnosis draft"
      });
    }
    if (needsDiagnosis && value.blockType === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockType"],
        message: "Weak reviews require a block type"
      });
    }
  });

const evidenceLocationSchema = bodyStringSchema
  .refine((value) => value.trim().length > 0, {
    message: "Evidence finding locations must be non-empty"
  })
  .refine((value) => !value.includes("\n"), {
    message: "Evidence finding locations must be single-line"
  })
  .transform((value) => value.trim());

export const evidenceFindingSchema = z
  .object({
    location: evidenceLocationSchema,
    issue: meaningfulBodyStringSchema
  })
  .strict();

export const evidenceRelationTypeSchema = z.enum([
  "requires",
  "proves_with",
  "illustrates",
  "refutes",
  "replaces"
]);

export const evidenceRelationInputSchema = z
  .object({
    targetEvidenceId: evidenceIdSchema,
    type: evidenceRelationTypeSchema
  })
  .strict();

export const evidenceCandidateCreateInputSchema = z
  .object({
    cardId: z.string().uuid(),
    statement: meaningfulBodyStringSchema,
    proofAttempt: meaningfulBodyStringSchema,
    predecessorIds: z.array(evidenceIdSchema).default([]),
    relations: z.array(evidenceRelationInputSchema).default([]),
    assistanceLevel: evidenceAssistanceLevelSchema
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.predecessorIds.forEach((id, index) => {
      if (seen.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["predecessorIds", index],
          message: "Evidence predecessor IDs must be unique"
        });
      }
      seen.add(id);
    });

    const relationTargets = new Set<string>();
    value.relations.forEach((relation, index) => {
      if (relationTargets.has(relation.targetEvidenceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relations", index, "targetEvidenceId"],
          message: "Evidence relations must target unique predecessors"
        });
      }
      relationTargets.add(relation.targetEvidenceId);
    });

    if (
      value.relations.length > 0 &&
      (value.relations.length !== value.predecessorIds.length ||
        value.relations.some(
          (relation, index) =>
            relation.targetEvidenceId !== value.predecessorIds[index]
        ))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relations"],
        message:
          "Evidence relations must cover predecessor IDs once and in submitted order"
      });
    }
  });

export const evidenceVerdictInputSchema = z
  .object({
    verifierKind: evidenceVerifierKindSchema,
    verificationReport: z
      .object({
        summary: meaningfulBodyStringSchema,
        criticalErrors: z.array(evidenceFindingSchema),
        gaps: z.array(evidenceFindingSchema)
      })
      .strict(),
    verdict: z.enum(["correct", "wrong"]),
    repairHints: bodyStringSchema,
    confirmed: z.boolean().default(false)
  })
  .strict()
  .superRefine((value, context) => {
    const clean =
      value.verificationReport.criticalErrors.length === 0 &&
      value.verificationReport.gaps.length === 0;

    if (clean !== (value.verdict === "correct")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verdict"],
        message:
          "Verdict must be correct if and only if critical errors and gaps are empty"
      });
    }

    if (value.verdict === "correct" && value.repairHints !== "") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repairHints"],
        message: "Correct verdicts require empty repair hints"
      });
    }

    if (value.verdict === "wrong" && value.repairHints.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repairHints"],
        message: "Wrong verdicts require non-empty repair hints"
      });
    }

    if (value.verifierKind === "gpt-plus-import" && !value.confirmed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmed"],
        message: "GPT Plus verdict imports require explicit confirmation"
      });
    }
  });

export const evidenceRevocationInputSchema = z
  .object({
    reason: meaningfulBodyStringSchema,
    confirmed: z.literal(true)
  })
  .strict();
