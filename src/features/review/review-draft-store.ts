import { isPrimaryCardType, type PrimaryCardType } from "../../../shared/card-types";
import { activeLibraryDraftKey } from "../../lib/active-library-drafts";
import { createDraftStore } from "../../lib/draft-store";
import type { BlockType } from "../cards/card-draft";

export type ReviewDraftCardContent = {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly concept: string;
  readonly relatedConcepts: string[];
  readonly excerpt: string;
  readonly understanding: string;
  readonly blockType: BlockType | null;
  readonly nextAction: string;
  readonly [key: string]: unknown;
};

export type ReviewDraft = {
  cardId: string;
  stage: "answering" | "revealed";
  answer: string;
  declaredDontKnow: boolean;
  confidence: 1 | 2 | 3 | 4 | null;
  assistanceLevel: "none" | "hint" | "source" | "ai";
  attemptStartedAt: number;
  attemptIdempotencyKey: string;
  attemptId: string | null;
  revealedCard: ReviewDraftCardContent | null;
  feedback: "forgot" | "fuzzy" | "known" | "fluent" | null;
  blockType: BlockType | "";
  selfCorrection: string;
  assumedProblem: string;
  causeHypothesis: string;
  nextMinimumAction: string;
  targetCardType: PrimaryCardType;
};

const BLOCK_TYPES: readonly BlockType[] = [
  "definition",
  "example",
  "counterexample",
  "proof-search",
  "technical",
  "expression",
  "transfer",
  "emotion"
];
const ASSISTANCE_LEVELS = ["none", "hint", "source", "ai"] as const;
const FEEDBACKS = ["forgot", "fuzzy", "known", "fluent"] as const;

function isReviewCardContent(value: unknown): value is ReviewDraftCardContent {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.concept === "string" &&
    Array.isArray(candidate.relatedConcepts) &&
    candidate.relatedConcepts.every((concept) => typeof concept === "string") &&
    typeof candidate.excerpt === "string" &&
    typeof candidate.understanding === "string" &&
    (candidate.blockType === null ||
      (typeof candidate.blockType === "string" &&
        BLOCK_TYPES.includes(candidate.blockType as BlockType))) &&
    typeof candidate.nextAction === "string"
  );
}

function isReviewDraft(value: unknown): value is ReviewDraft {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.cardId === "string" &&
    (candidate.stage === "answering" || candidate.stage === "revealed") &&
    typeof candidate.answer === "string" &&
    typeof candidate.declaredDontKnow === "boolean" &&
    (candidate.confidence === null ||
      candidate.confidence === 1 ||
      candidate.confidence === 2 ||
      candidate.confidence === 3 ||
      candidate.confidence === 4) &&
    typeof candidate.assistanceLevel === "string" &&
    ASSISTANCE_LEVELS.includes(
      candidate.assistanceLevel as (typeof ASSISTANCE_LEVELS)[number]
    ) &&
    typeof candidate.attemptStartedAt === "number" &&
    Number.isFinite(candidate.attemptStartedAt) &&
    typeof candidate.attemptIdempotencyKey === "string" &&
    (candidate.attemptId === null || typeof candidate.attemptId === "string") &&
    (candidate.revealedCard === null || isReviewCardContent(candidate.revealedCard)) &&
    (candidate.feedback === null ||
      (typeof candidate.feedback === "string" &&
        FEEDBACKS.includes(candidate.feedback as (typeof FEEDBACKS)[number]))) &&
    typeof candidate.blockType === "string" &&
    (candidate.blockType === "" ||
      BLOCK_TYPES.includes(candidate.blockType as BlockType)) &&
    typeof candidate.selfCorrection === "string" &&
    typeof candidate.assumedProblem === "string" &&
    typeof candidate.causeHypothesis === "string" &&
    typeof candidate.nextMinimumAction === "string" &&
    typeof candidate.targetCardType === "string" &&
    isPrimaryCardType(candidate.targetCardType)
  );
}

const store = createDraftStore<ReviewDraft>({
  key: "review",
  validate: isReviewDraft
});

export function readReviewDraft(): ReviewDraft | null {
  return store.read(activeLibraryDraftKey())?.payload ?? null;
}

export function writeReviewDraft(draft: ReviewDraft): void {
  store.write(activeLibraryDraftKey(), draft, { sourceIds: [draft.cardId] });
}

export function clearReviewDraft(): void {
  store.clear(activeLibraryDraftKey());
}
