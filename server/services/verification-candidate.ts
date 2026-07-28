import { readFile } from "node:fs/promises";
import { evidenceCandidateCreateInputSchema } from "../domain/schemas";
import type { EvidenceCandidateCreateInput } from "../domain/types";
import { parseCardMarkdown } from "../lib/markdown-codec";
import { resolveInsideRoot } from "../lib/path-safety";
import { getCardByIdInVault } from "./card-service";
import { getReadingByRelativePathInVault } from "./reading-service";
import {
  VerificationServiceError,
  candidateV2IdFor,
  sha256,
  statusFor
} from "./verification-domain";
import type {
  EvidenceCandidateDetail,
  EvidenceCandidateSummary,
  EvidenceCandidateV2Record,
  EvidenceContextSnapshot,
  EvidenceRelationRecord
} from "./verification-domain";
import { candidateMarkdown, verificationPrompt } from "./verification-format";
import { toEvidenceSummary } from "./verification-projection";
import {
  candidateById,
  createVerificationFile,
  readVerificationState,
  vaultRelativePath
} from "./verification-store";

export async function getEvidenceCandidateInVault(
  vaultPath: string,
  id: string
): Promise<EvidenceCandidateDetail> {
  const found = await candidateById(vaultPath, id);
  if (found === null) {
    throw new VerificationServiceError(
      "EVIDENCE_CANDIDATE_NOT_FOUND",
      "Evidence candidate was not found",
      404
    );
  }
  const state = await readVerificationState(vaultPath);
  return {
    ...toEvidenceSummary(found.record, state),
    cardPath: found.record.cardPath,
    proofAttempt: found.record.proofAttempt,
    relativePath: vaultRelativePath(vaultPath, found.absolutePath),
    verificationPrompt: verificationPrompt(found.record)
  };
}

export async function createEvidenceCandidateInVault(
  vaultPath: string,
  rawInput: EvidenceCandidateCreateInput
): Promise<{ candidate: EvidenceCandidateDetail; replayed: boolean }> {
  const input = evidenceCandidateCreateInputSchema.parse(rawInput);
  const indexedCard = await getCardByIdInVault(vaultPath, input.cardId);
  const cardRaw = await readFile(
    resolveInsideRoot(vaultPath, indexedCard.relativePath),
    "utf8"
  );
  const card = parseCardMarkdown(cardRaw);
  if (card.id !== indexedCard.id) {
    throw new VerificationServiceError(
      "CARD_SNAPSHOT_CHANGED",
      "Card identity changed while freezing verification context",
      409
    );
  }
  const reading = await getReadingByRelativePathInVault(
    vaultPath,
    card.sourceReading
  );
  const contextSnapshot: EvidenceContextSnapshot = {
    cardRevision: card.revisionLog.length,
    cardSnapshotSha256: sha256(cardRaw),
    sourceSnapshots: [{
      readingId: reading.id,
      relativePath: reading.relativePath,
      snapshotSha256: sha256(reading.rawMarkdown),
      excerpt: card.excerpt,
      locator: null
    }]
  };
  const state = await readVerificationState(vaultPath);
  const candidatesById = new Map(
    state.candidates.map((candidate) => [candidate.id, candidate])
  );
  const verdictByCandidate = new Map(
    state.verdicts.map((verdict) => [verdict.candidateId, verdict])
  );
  const relationInputs = input.relations.length > 0
    ? input.relations
    : input.predecessorIds.map((targetEvidenceId) => ({
        targetEvidenceId,
        type: "requires" as const
      }));
  const relations: EvidenceRelationRecord[] = [];
  for (const relation of relationInputs) {
    const predecessor = candidatesById.get(relation.targetEvidenceId);
    if (predecessor === undefined) {
      throw new VerificationServiceError(
        "EVIDENCE_CANDIDATE_NOT_FOUND",
        `Predecessor ${relation.targetEvidenceId} was not found`,
        404
      );
    }
    if (statusFor(
      predecessor,
      verdictByCandidate.get(predecessor.id) ?? null,
      state.revocations
    ) !== "accepted") {
      throw new VerificationServiceError(
        "EVIDENCE_PREDECESSOR_NOT_ACCEPTED",
        `Predecessor ${predecessor.id} has not been accepted or is under review`,
        409
      );
    }
    relations.push({
      targetEvidenceId: predecessor.id,
      targetCardId: predecessor.cardId,
      type: relation.type
    });
  }
  const identity = {
    cardId: card.id,
    statement: input.statement,
    proofAttempt: input.proofAttempt,
    predecessorIds: input.predecessorIds,
    relations,
    assistanceLevel: input.assistanceLevel,
    contextSnapshot
  };
  const id = candidateV2IdFor(identity);
  if (input.predecessorIds.includes(id)) {
    throw new VerificationServiceError(
      "EVIDENCE_SELF_DEPENDENCY",
      "Evidence cannot depend on itself",
      409
    );
  }
  if (await candidateById(vaultPath, id) !== null) {
    return {
      candidate: await getEvidenceCandidateInVault(vaultPath, id),
      replayed: true
    };
  }
  const record: EvidenceCandidateV2Record = {
    schemaVersion: 2,
    id,
    type: "verification-evidence",
    title: `候选证据：${card.title}`,
    concept: card.concept,
    cardId: card.id,
    cardPath: indexedCard.relativePath,
    statement: input.statement,
    proofAttempt: input.proofAttempt,
    predecessorIds: input.predecessorIds,
    relations,
    assistanceLevel: input.assistanceLevel,
    evidenceQuality: input.assistanceLevel === "none" ? "independent" : "assisted",
    contextSnapshot,
    createdAt: new Date().toISOString()
  };
  const created = await createVerificationFile(
    vaultPath,
    `${record.id}.md`,
    candidateMarkdown(record)
  );
  return {
    candidate: await getEvidenceCandidateInVault(vaultPath, id),
    replayed: !created
  };
}

export async function listEvidenceCandidatesInVault(
  vaultPath: string
): Promise<{
  candidates: EvidenceCandidateSummary[];
  diagnostics: import("./verification-domain").VerificationDiagnostic[];
}> {
  const state = await readVerificationState(vaultPath);
  return {
    candidates: state.candidates
      .map((record) => toEvidenceSummary(record, state))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    diagnostics: state.diagnostics
  };
}
