import { activeLibraryDraftKey } from "../../lib/active-library-drafts";
import {
  createDraftStore,
  type DraftWriteResult
} from "../../lib/draft-store";
import type {
  AssistanceLevel,
  Finding,
  RelationType,
  VerifierKind
} from "./verification-contract";

export type VerificationDraft = {
  cardId: string;
  statement: string;
  proofAttempt: string;
  assistanceLevel: AssistanceLevel;
  predecessorIds: string[];
  relationTypes: Record<string, RelationType>;
  activeId: string | null;
  verifierKind: VerifierKind;
  summary: string;
  verdict: "correct" | "wrong";
  criticalErrors: Finding[];
  gaps: Finding[];
  repairHints: string;
  gptJson: string;
  gptConfirmed: boolean;
  revocationReason: string;
  revocationConfirmed: boolean;
};

const ASSISTANCE_LEVELS = ["none", "hint", "source", "ai"] as const;
const RELATION_TYPES = [
  "requires",
  "proves_with",
  "illustrates",
  "refutes",
  "replaces"
] as const;
const VERIFIER_KINDS = [
  "ai-review",
  "human-review",
  "gpt-plus-import"
] as const;

function isFinding(value: unknown): value is Finding {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.location === "string" &&
    typeof candidate.issue === "string"
  );
}

function isVerificationDraft(value: unknown): value is VerificationDraft {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const relationTypes = candidate.relationTypes;
  return (
    typeof candidate.cardId === "string" &&
    typeof candidate.statement === "string" &&
    typeof candidate.proofAttempt === "string" &&
    typeof candidate.assistanceLevel === "string" &&
    ASSISTANCE_LEVELS.includes(
      candidate.assistanceLevel as (typeof ASSISTANCE_LEVELS)[number]
    ) &&
    Array.isArray(candidate.predecessorIds) &&
    candidate.predecessorIds.every((id) => typeof id === "string") &&
    relationTypes !== null &&
    typeof relationTypes === "object" &&
    Object.values(relationTypes).every(
      (relation) =>
        typeof relation === "string" &&
        RELATION_TYPES.includes(relation as (typeof RELATION_TYPES)[number])
    ) &&
    (candidate.activeId === null || typeof candidate.activeId === "string") &&
    typeof candidate.verifierKind === "string" &&
    VERIFIER_KINDS.includes(
      candidate.verifierKind as (typeof VERIFIER_KINDS)[number]
    ) &&
    typeof candidate.summary === "string" &&
    (candidate.verdict === "correct" || candidate.verdict === "wrong") &&
    Array.isArray(candidate.criticalErrors) &&
    candidate.criticalErrors.every(isFinding) &&
    Array.isArray(candidate.gaps) &&
    candidate.gaps.every(isFinding) &&
    typeof candidate.repairHints === "string" &&
    typeof candidate.gptJson === "string" &&
    typeof candidate.gptConfirmed === "boolean" &&
    typeof candidate.revocationReason === "string" &&
    typeof candidate.revocationConfirmed === "boolean"
  );
}

const store = createDraftStore<VerificationDraft>({
  key: "verification",
  validate: isVerificationDraft
});

export function readVerificationDraft(): VerificationDraft | null {
  return store.read(activeLibraryDraftKey())?.payload ?? null;
}

export function writeVerificationDraft(
  draft: VerificationDraft
): DraftWriteResult {
  return store.write(activeLibraryDraftKey(), draft, {
    sourceIds: draft.cardId.length === 0 ? [] : [draft.cardId]
  });
}

export function clearVerificationDraft(): void {
  store.clear(activeLibraryDraftKey());
}
