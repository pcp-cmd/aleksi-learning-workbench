import { isCardType } from "../../../shared/card-types";
import { activeLibraryDraftKey } from "../../lib/active-library-drafts";
import { createDraftStore } from "../../lib/draft-store";
import type { DraftWriteResult } from "../../lib/draft-store";
import type { CardDraft } from "./card-draft";

const COMMON_STRING_FIELDS = [
  "title",
  "concept",
  "sourceReadingId",
  "sourcePath",
  "excerpt",
  "understanding",
  "nextAction",
  "createdAt",
  "nextReview"
] as const;

const TYPE_STRING_FIELDS = {
  concept: ["formalExplanation", "myUnderstanding", "commonMisunderstanding", "usageContext"],
  definition: ["formalDefinition", "plainExplanation", "quantifierStructure", "commonMisunderstandings"],
  example: ["exampleContent", "whyItFits", "trainingPurpose"],
  boundary: ["confusingObjects", "similarity", "keyDifference", "judgementRule"],
  counterexample: ["counterexampleContent", "brokenCondition", "whyItIsNot"],
  process: ["task", "steps", "keyTurn", "pitfall", "usageContext"],
  mistake: ["mistake", "originalThinking", "realCause", "correctMethod", "recognitionSignal"],
  proof: ["proposition", "firstAttempt", "keyMove", "proofOutline", "failureReason"]
} as const;

function isCardDraft(value: unknown): value is CardDraft {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string" || !isCardType(candidate.type)) {
    return false;
  }

  return (
    COMMON_STRING_FIELDS.every((field) => typeof candidate[field] === "string") &&
    TYPE_STRING_FIELDS[candidate.type].every(
      (field) => typeof candidate[field] === "string"
    ) &&
    Array.isArray(candidate.relatedConcepts) &&
    candidate.relatedConcepts.every((concept) => typeof concept === "string") &&
    (candidate.blockType === null || typeof candidate.blockType === "string")
  );
}

const store = createDraftStore<CardDraft>({
  key: "card-studio",
  validate: isCardDraft
});

export function readCardDraft(): CardDraft | null {
  return store.read(activeLibraryDraftKey())?.payload ?? null;
}

export function writeCardDraft(draft: CardDraft): DraftWriteResult {
  return store.write(activeLibraryDraftKey(), draft, {
    sourceIds: draft.sourceReadingId.length === 0 ? [] : [draft.sourceReadingId]
  });
}

export function clearCardDraft(): void {
  store.clear(activeLibraryDraftKey());
}
