import { useEffect, useRef, useState } from "react";
import { useUnsavedChanges } from "../../lib/unsaved-guard";
import {
  emptyFinding,
  type AssistanceLevel,
  type Finding,
  type RelationType,
  type VerifierKind
} from "./verification-contract";
import {
  clearVerificationDraft,
  readVerificationDraft,
  writeVerificationDraft,
  type VerificationDraft
} from "./verification-draft-store";

export function useVerificationDraftState(requestedCardId: string) {
  const [recoveredDraft] = useState(() => {
    const stored = readVerificationDraft();
    return requestedCardId !== "" && stored?.cardId !== requestedCardId
      ? null
      : stored;
  });
  const skipFirstActiveReset = useRef(recoveredDraft !== null);
  const [cardId, setCardId] = useState(
    () => requestedCardId || recoveredDraft?.cardId || ""
  );
  const [statement, setStatement] = useState(recoveredDraft?.statement ?? "");
  const [proofAttempt, setProofAttempt] = useState(
    recoveredDraft?.proofAttempt ?? ""
  );
  const [assistanceLevel, setAssistanceLevel] = useState<AssistanceLevel>(
    recoveredDraft?.assistanceLevel ?? "none"
  );
  const [predecessorIds, setPredecessorIds] = useState<string[]>(
    recoveredDraft?.predecessorIds ?? []
  );
  const [relationTypes, setRelationTypes] = useState<Record<string, RelationType>>(
    recoveredDraft?.relationTypes ?? {}
  );
  const [activeId, setActiveId] = useState<string | null>(
    recoveredDraft?.activeId ?? null
  );
  const [verifierKind, setVerifierKind] = useState<VerifierKind>(
    recoveredDraft?.verifierKind ?? "ai-review"
  );
  const [summary, setSummary] = useState(recoveredDraft?.summary ?? "");
  const [verdict, setVerdict] = useState<"correct" | "wrong">(
    recoveredDraft?.verdict ?? "wrong"
  );
  const [criticalErrors, setCriticalErrors] = useState<Finding[]>(
    recoveredDraft?.criticalErrors ?? [emptyFinding()]
  );
  const [gaps, setGaps] = useState<Finding[]>(
    recoveredDraft?.gaps ?? [emptyFinding()]
  );
  const [repairHints, setRepairHints] = useState(
    recoveredDraft?.repairHints ?? ""
  );
  const [gptJson, setGptJson] = useState(recoveredDraft?.gptJson ?? "");
  const [gptConfirmed, setGptConfirmed] = useState(
    recoveredDraft?.gptConfirmed ?? false
  );
  const [revocationReason, setRevocationReason] = useState(
    recoveredDraft?.revocationReason ?? ""
  );
  const [revocationConfirmed, setRevocationConfirmed] = useState(
    recoveredDraft?.revocationConfirmed ?? false
  );

  const candidateDraftDirty =
    statement !== "" ||
    proofAttempt !== "" ||
    predecessorIds.length > 0 ||
    assistanceLevel !== "none";
  const verdictDraftDirty =
    summary !== "" ||
    criticalErrors.some((finding) => finding.location !== "" || finding.issue !== "") ||
    gaps.some((finding) => finding.location !== "" || finding.issue !== "") ||
    repairHints !== "" ||
    verdict !== "wrong" ||
    verifierKind !== "ai-review" ||
    gptJson !== "" ||
    revocationReason !== "";
  const markVerificationDraftClean = useUnsavedChanges(
    candidateDraftDirty || verdictDraftDirty,
    { navigationRecoverable: true }
  );
  const verificationDraft: VerificationDraft = {
    cardId,
    statement,
    proofAttempt,
    assistanceLevel,
    predecessorIds,
    relationTypes,
    activeId,
    verifierKind,
    summary,
    verdict,
    criticalErrors,
    gaps,
    repairHints,
    gptJson,
    gptConfirmed,
    revocationReason,
    revocationConfirmed
  };
  const snapshot = JSON.stringify(verificationDraft);

  useEffect(() => {
    if (candidateDraftDirty || verdictDraftDirty) {
      writeVerificationDraft(verificationDraft);
    } else {
      clearVerificationDraft();
    }
  }, [candidateDraftDirty, snapshot, verdictDraftDirty]);

  return {
    activeId, assistanceLevel, candidateDraftDirty, cardId, criticalErrors,
    gaps, gptConfirmed, gptJson, markVerificationDraftClean, predecessorIds,
    proofAttempt, relationTypes, repairHints, revocationConfirmed,
    revocationReason, setActiveId, setAssistanceLevel, setCardId,
    setCriticalErrors, setGaps, setGptConfirmed, setGptJson, setPredecessorIds,
    setProofAttempt, setRelationTypes, setRepairHints, setRevocationConfirmed,
    setRevocationReason, setStatement, setSummary, setVerdict, setVerifierKind,
    skipFirstActiveReset, statement, summary, verdict, verdictDraftDirty,
    verificationDraft, verifierKind
  };
}
