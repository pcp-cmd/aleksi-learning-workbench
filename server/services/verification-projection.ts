import type {
  CandidateRevocationImpact,
  EvidenceCandidateRecord,
  EvidenceCandidateSummary,
  EvidenceRevocationRecord,
  KnowledgeNodeProjection,
  KnowledgeRelationProjection,
  KnowledgeTrustState,
  RevocationImpact,
  VerificationState
} from "./verification-domain";
import {
  candidateImpacts,
  relationRecords,
  statusFor
} from "./verification-domain";

export function toEvidenceSummary(
  record: EvidenceCandidateRecord,
  state: VerificationState
): EvidenceCandidateSummary {
  const verdict =
    state.verdicts.find((item) => item.candidateId === record.id) ?? null;
  const candidatesById = new Map(
    state.candidates.map((candidate) => [candidate.id, candidate])
  );
  return {
    id: record.id,
    title: record.title,
    concept: record.concept,
    cardId: record.cardId,
    statement: record.statement,
    predecessorIds: record.predecessorIds,
    relations: relationRecords(record, candidatesById),
    assistanceLevel: record.assistanceLevel,
    evidenceQuality: record.evidenceQuality,
    contextSnapshot:
      record.schemaVersion === 2 ? record.contextSnapshot : null,
    createdAt: record.createdAt,
    status: statusFor(record, verdict, state.revocations),
    qualifiesForMastery: false,
    verdict,
    revocationImpacts: candidateImpacts(record.id, state.revocations)
  };
}

export function buildRevocationImpacts(
  root: EvidenceCandidateRecord,
  candidates: EvidenceCandidateRecord[]
): RevocationImpact[] {
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.id, candidate])
  );
  const children = new Map<string, EvidenceCandidateRecord[]>();
  for (const candidate of candidates) {
    for (const predecessorId of candidate.predecessorIds) {
      const list = children.get(predecessorId) ?? [];
      list.push(candidate);
      children.set(predecessorId, list);
    }
  }
  for (const list of children.values()) {
    list.sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt)
    );
  }

  const impacts: RevocationImpact[] = [{
    evidenceId: root.id,
    cardId: root.cardId,
    upstreamEvidenceId: null,
    upstreamCardId: null,
    path: [root.id]
  }];
  const paths = new Map<string, string[]>([[root.id, [root.id]]]);
  const queue = [root.id];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (parentId === undefined) break;
    const parent = candidatesById.get(parentId);
    if (parent === undefined) continue;
    for (const child of children.get(parentId) ?? []) {
      if (paths.has(child.id)) continue;
      const path = [...(paths.get(parentId) ?? [root.id]), child.id];
      paths.set(child.id, path);
      impacts.push({
        evidenceId: child.id,
        cardId: child.cardId,
        upstreamEvidenceId: parent.id,
        upstreamCardId: parent.cardId,
        path
      });
      queue.push(child.id);
    }
  }
  return impacts;
}

function uniqueRelations(
  values: KnowledgeRelationProjection[]
): KnowledgeRelationProjection[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.cardId}:${value.evidenceId}:${value.relationType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function projectionImpacts(
  cardId: string,
  records: EvidenceRevocationRecord[]
): CandidateRevocationImpact[] {
  return records.flatMap((record) => record.impacts
    .filter((impact) => impact.cardId === cardId)
    .map((impact) => ({
      ...impact,
      rootEvidenceId: record.rootEvidenceId,
      reason: record.reason,
      revokedAt: record.revokedAt
    })));
}

export function buildKnowledgeNodeProjection(
  cardId: string,
  state: VerificationState
): KnowledgeNodeProjection {
  const candidatesById = new Map(
    state.candidates.map((candidate) => [candidate.id, candidate])
  );
  const verdictByCandidate = new Map(
    state.verdicts.map((verdict) => [verdict.candidateId, verdict])
  );
  const statusByCandidate = new Map(
    state.candidates.map((candidate) => [candidate.id, statusFor(
      candidate,
      verdictByCandidate.get(candidate.id) ?? null,
      state.revocations
    )])
  );
  const nodeCandidates = state.candidates.filter(
    (candidate) => candidate.cardId === cardId
  );
  const active = nodeCandidates.filter(
    (candidate) => statusByCandidate.get(candidate.id) === "accepted"
  );
  const affected = nodeCandidates.filter((candidate) => {
    const status = statusByCandidate.get(candidate.id);
    return status === "revoked" || status === "affected";
  });
  const trustState: KnowledgeTrustState = affected.length > 0
    ? "under-review"
    : active.some((candidate) => candidate.evidenceQuality === "independent")
      ? "independently-supported"
      : active.length > 0 ? "supported" : "unverified";
  const prerequisites = uniqueRelations(active.flatMap((candidate) =>
    relationRecords(candidate, candidatesById).map((relation) => ({
      cardId: relation.targetCardId,
      evidenceId: relation.targetEvidenceId,
      relationType: relation.type
    }))));
  const usedBy = uniqueRelations(state.candidates
    .filter((candidate) => statusByCandidate.get(candidate.id) === "accepted")
    .flatMap((candidate) => relationRecords(candidate, candidatesById)
      .filter((relation) => relation.targetCardId === cardId)
      .map((relation) => ({
        cardId: candidate.cardId,
        evidenceId: candidate.id,
        relationType: relation.type
      }))));

  return {
    cardId,
    trustState,
    activeEvidenceIds: active.map((candidate) => candidate.id),
    affectedEvidenceIds: affected.map((candidate) => candidate.id),
    prerequisites,
    usedBy,
    revocationImpacts: projectionImpacts(cardId, state.revocations)
  };
}
