import { CARD_LABELS } from "../../../shared/card-labels";
import type { CardType } from "../../../shared/card-types";
import type { ReaderSelectionPayload } from "../reader/selection";

export type { CardType };

export type BlockType =
  | "definition"
  | "example"
  | "counterexample"
  | "proof-search"
  | "technical"
  | "expression"
  | "transfer"
  | "emotion";

type CardDraftBase = {
  title: string;
  type: CardType;
  concept: string;
  relatedConcepts: string[];
  sourceReadingId: string;
  sourcePath: string;
  excerpt: string;
  understanding: string;
  blockType: BlockType | null;
  nextAction: string;
  createdAt: string;
  nextReview: string;
};

export type DefinitionCardDraft = CardDraftBase & {
  type: "definition";
  formalDefinition: string;
  plainExplanation: string;
  quantifierStructure: string;
  commonMisunderstandings: string;
};

export type ConceptCardDraft = CardDraftBase & {
  type: "concept";
  formalExplanation: string;
  myUnderstanding: string;
  commonMisunderstanding: string;
  usageContext: string;
};

export type ExampleCardDraft = CardDraftBase & {
  type: "example";
  exampleContent: string;
  whyItFits: string;
  trainingPurpose: string;
};

export type BoundaryCardDraft = CardDraftBase & {
  type: "boundary";
  confusingObjects: string;
  similarity: string;
  keyDifference: string;
  judgementRule: string;
};

export type CounterexampleCardDraft = CardDraftBase & {
  type: "counterexample";
  counterexampleContent: string;
  brokenCondition: string;
  whyItIsNot: string;
};

export type ProcessCardDraft = CardDraftBase & {
  type: "process";
  task: string;
  steps: string;
  keyTurn: string;
  pitfall: string;
  usageContext: string;
};

export type MistakeCardDraft = CardDraftBase & {
  type: "mistake";
  mistake: string;
  originalThinking: string;
  realCause: string;
  correctMethod: string;
  recognitionSignal: string;
};

export type ProofCardDraft = CardDraftBase & {
  type: "proof";
  proposition: string;
  firstAttempt: string;
  keyMove: string;
  proofOutline: string;
  failureReason: string;
};

export type CardDraft =
  | ConceptCardDraft
  | DefinitionCardDraft
  | ExampleCardDraft
  | BoundaryCardDraft
  | CounterexampleCardDraft
  | ProcessCardDraft
  | MistakeCardDraft
  | ProofCardDraft;

export type CardCreateRequest =
  | Omit<ConceptCardDraft, "createdAt" | "nextReview" | "sourcePath">
  | Omit<DefinitionCardDraft, "createdAt" | "nextReview" | "sourcePath">
  | Omit<ExampleCardDraft, "createdAt" | "nextReview" | "sourcePath">
  | Omit<BoundaryCardDraft, "createdAt" | "nextReview" | "sourcePath">
  | Omit<CounterexampleCardDraft, "createdAt" | "nextReview" | "sourcePath">
  | Omit<ProcessCardDraft, "createdAt" | "nextReview" | "sourcePath">
  | Omit<MistakeCardDraft, "createdAt" | "nextReview" | "sourcePath">
  | Omit<ProofCardDraft, "createdAt" | "nextReview" | "sourcePath">;

export type EditableCardMastery = "learning" | "mastered" | "rebuild";
export type CardUpdateRequest = CardCreateRequest & {
  mastery: EditableCardMastery;
};

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function baseDraft(
  selection: ReaderSelectionPayload & { cardType: CardType },
  now: Date
): CardDraftBase {
  return {
    type: selection.cardType,
    title: `${selection.concept} ${CARD_LABELS[selection.cardType].label}`,
    concept: selection.concept,
    relatedConcepts: [],
    sourceReadingId: selection.sourceReadingId,
    sourcePath: selection.sourcePath,
    excerpt: selection.excerpt,
    understanding: "",
    blockType: null,
    nextAction: "",
    createdAt: now.toISOString(),
    nextReview: dateOnly(now)
  };
}

export function createCardDraftFromReaderSelection(
  selection: ReaderSelectionPayload & { cardType: CardType },
  now = new Date()
): CardDraft {
  const base = baseDraft(selection, now);

  switch (selection.cardType) {
    case "concept":
      return {
        ...base,
        type: "concept",
        formalExplanation: "",
        myUnderstanding: "",
        commonMisunderstanding: "",
        usageContext: ""
      };
    case "definition":
      return {
        ...base,
        type: "definition",
        formalDefinition: "",
        plainExplanation: "",
        quantifierStructure: "",
        commonMisunderstandings: ""
      };
    case "example":
      return {
        ...base,
        type: "example",
        exampleContent: "",
        whyItFits: "",
        trainingPurpose: ""
      };
    case "boundary":
      return {
        ...base,
        type: "boundary",
        confusingObjects: "",
        similarity: "",
        keyDifference: "",
        judgementRule: ""
      };
    case "counterexample":
      return {
        ...base,
        type: "counterexample",
        counterexampleContent: "",
        brokenCondition: "",
        whyItIsNot: ""
      };
    case "process":
      return {
        ...base,
        type: "process",
        task: "",
        steps: "",
        keyTurn: "",
        pitfall: "",
        usageContext: ""
      };
    case "mistake":
      return {
        ...base,
        type: "mistake",
        mistake: "",
        originalThinking: "",
        realCause: "",
        correctMethod: "",
        recognitionSignal: ""
      };
    case "proof":
      return {
        ...base,
        type: "proof",
        proposition: "",
        firstAttempt: "",
        keyMove: "",
        proofOutline: "",
        failureReason: ""
      };
  }
}

export function createEmptyCardDraft(cardType: CardType, now = new Date()): CardDraft {
  return createCardDraftFromReaderSelection(
    {
      source: "reader-selection",
      target: "cards",
      cardType,
      sourceReadingId: "",
      sourcePath: "",
      concept: "",
      excerpt: ""
    },
    now
  );
}

export function createCardDraftFromPersistedCard(
  card: Record<string, unknown>
): CardDraft | null {
  const type =
    typeof card.type === "string" && card.type in CARD_LABELS
      ? (card.type as CardType)
      : null;
  const sourceReadingId =
    typeof card.sourceReadingId === "string"
      ? card.sourceReadingId.trim()
      : "";
  if (type === null || sourceReadingId === "") {
    return null;
  }

  const createdAt =
    typeof card.createdAt === "string" &&
    !Number.isNaN(new Date(card.createdAt).getTime())
      ? new Date(card.createdAt)
      : new Date(0);
  const draft = createEmptyCardDraft(type, createdAt) as CardDraft &
    Record<string, unknown>;
  for (const key of Object.keys(draft)) {
    if (
      key !== "sourceReadingId" &&
      key !== "sourcePath" &&
      Object.prototype.hasOwnProperty.call(card, key)
    ) {
      draft[key] = card[key];
    }
  }
  draft.sourceReadingId = sourceReadingId;
  draft.sourcePath =
    typeof card.sourceReading === "string" ? card.sourceReading : "";
  return draft;
}

export function cardDraftToCreateRequest(draft: CardDraft): CardCreateRequest {
  const {
    createdAt: _createdAt,
    nextReview: _nextReview,
    sourcePath: _sourcePath,
    ...request
  } = draft;

  return request;
}

export function cardDraftToUpdateRequest(
  draft: CardDraft,
  mastery: EditableCardMastery
): CardUpdateRequest {
  return {
    ...cardDraftToCreateRequest(draft),
    mastery
  } as CardUpdateRequest;
}
