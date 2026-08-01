import { isPrimaryCardType, type PrimaryCardType } from "../../../shared/card-types";
import { activeLibraryDraftKey } from "../../lib/active-library-drafts";
import { createDraftStore } from "../../lib/draft-store";
import type { DraftWriteResult } from "../../lib/draft-store";
import type { BlockType } from "../cards/card-draft";

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

export type DiagnosisDraft = {
  concept: string;
  relatedCardId: string;
  blockType: BlockType;
  manifestation: string;
  assumedProblem: string;
  actualCause: string;
  nextMinimumAction: string;
  targetCardType: PrimaryCardType;
};

function isDiagnosisDraft(value: unknown): value is DiagnosisDraft {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.concept === "string" &&
    typeof candidate.relatedCardId === "string" &&
    typeof candidate.blockType === "string" &&
    BLOCK_TYPES.includes(candidate.blockType as BlockType) &&
    typeof candidate.manifestation === "string" &&
    typeof candidate.assumedProblem === "string" &&
    typeof candidate.actualCause === "string" &&
    typeof candidate.nextMinimumAction === "string" &&
    typeof candidate.targetCardType === "string" &&
    isPrimaryCardType(candidate.targetCardType)
  );
}

const store = createDraftStore<DiagnosisDraft>({
  key: "diagnosis",
  validate: isDiagnosisDraft
});

export function readDiagnosisDraft(): DiagnosisDraft | null {
  return store.read(activeLibraryDraftKey())?.payload ?? null;
}

export function writeDiagnosisDraft(
  draft: DiagnosisDraft,
  sourceIds: readonly string[] = []
): DraftWriteResult {
  return store.write(activeLibraryDraftKey(), draft, { sourceIds });
}

export function clearDiagnosisDraft(): void {
  store.clear(activeLibraryDraftKey());
}
