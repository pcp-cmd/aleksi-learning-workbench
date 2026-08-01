import {
  AI_CONTEXT_DEFAULT_BUDGET_TOKENS,
  AI_CONTEXT_MAXIMUM_BUDGET_TOKENS,
  AI_CONTEXT_MINIMUM_BUDGET_TOKENS,
  AI_CONTEXT_SAFETY_MARGIN_RATIO
} from "../../shared/document-limits";
import type {
  AIContextBundle,
  AIContextRequest,
  StoredDocumentChunk,
  StoredDocumentIndex
} from "../../shared/document-contract";
import type { LibraryOperationContext } from "../persistence/library-context";
import { readDocumentSourceRange } from "./document-source";
import { searchStoredDocument } from "./document-search";

type Candidate = { chunk: StoredDocumentChunk; reason: string; priority: number };

export type AIContextPlan = {
  selected: Array<{ chunk: StoredDocumentChunk; reason: string }>;
  totalEstimatedTokens: number;
  truncated: boolean;
};

function normalizedBudget(requested: number | undefined): number {
  const budget = requested ?? AI_CONTEXT_DEFAULT_BUDGET_TOKENS;
  if (!Number.isSafeInteger(budget)) return AI_CONTEXT_DEFAULT_BUDGET_TOKENS;
  return Math.max(
    AI_CONTEXT_MINIMUM_BUDGET_TOKENS,
    Math.min(budget, AI_CONTEXT_MAXIMUM_BUDGET_TOKENS)
  );
}

function contextCandidates(
  document: StoredDocumentIndex,
  request: AIContextRequest
): Candidate[] {
  const byId = new Map(document.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const candidates: Candidate[] = [];
  if (request.selectedRange !== undefined) {
    for (const chunk of document.chunks) {
      if (
        chunk.sourceEndOffset > request.selectedRange.startOffset &&
        chunk.sourceStartOffset < request.selectedRange.endOffset
      ) {
        candidates.push({ chunk, reason: "selected-range", priority: 100 });
      }
    }
  }
  const active = request.activeChunkId === undefined ? undefined : byId.get(request.activeChunkId);
  if (active !== undefined) {
    candidates.push({ chunk: active, reason: "active-section", priority: 90 });
    const previous = active.previousChunkId === undefined ? undefined : byId.get(active.previousChunkId);
    const next = active.nextChunkId === undefined ? undefined : byId.get(active.nextChunkId);
    if (previous !== undefined) candidates.push({ chunk: previous, reason: "previous-section", priority: 60 });
    if (next !== undefined) candidates.push({ chunk: next, reason: "next-section", priority: 60 });
  }
  if (request.query?.trim()) {
    for (const result of searchStoredDocument(document, request.query, 12)) {
      const chunk = byId.get(result.chunkId);
      if (chunk !== undefined) candidates.push({ chunk, reason: "query-match", priority: 70 });
    }
  }
  if (request.mode === "document-summary") {
    for (const chunk of document.chunks) {
      candidates.push({ chunk, reason: "document-summary", priority: 10 });
    }
  }
  return candidates.sort((left, right) => right.priority - left.priority);
}

export function planAIContextChunks(
  document: StoredDocumentIndex,
  request: AIContextRequest
): AIContextPlan {
  const budget = normalizedBudget(request.budgetTokens);
  const usableBudget = Math.floor(budget * (1 - AI_CONTEXT_SAFETY_MARGIN_RATIO));
  const selected: AIContextPlan["selected"] = [];
  const seen = new Set<string>();
  let totalEstimatedTokens = 0;
  let truncated = false;
  for (const candidate of contextCandidates(document, request)) {
    if (seen.has(candidate.chunk.chunkId)) continue;
    seen.add(candidate.chunk.chunkId);
    if (totalEstimatedTokens + candidate.chunk.estimatedTokens > usableBudget) {
      truncated = true;
      continue;
    }
    selected.push({ chunk: candidate.chunk, reason: candidate.reason });
    totalEstimatedTokens += candidate.chunk.estimatedTokens;
  }
  return { selected, totalEstimatedTokens, truncated };
}

export async function buildAIContextBundle(
  context: LibraryOperationContext,
  document: StoredDocumentIndex,
  request: AIContextRequest
): Promise<AIContextBundle> {
  const plan = planAIContextChunks(document, request);
  const selected = [] as AIContextBundle["chunks"];
  const reasons = new Set<string>();

  for (const candidate of plan.selected) {
    const content = await readDocumentSourceRange(
      context.path,
      document.sourcePath,
      candidate.chunk.sourceStartOffset,
      candidate.chunk.sourceEndOffset
    );
    selected.push({
      chunkId: candidate.chunk.chunkId,
      headingPath: candidate.chunk.headingPath,
      content,
      estimatedTokens: candidate.chunk.estimatedTokens,
      sourceStartOffset: candidate.chunk.sourceStartOffset,
      sourceEndOffset: candidate.chunk.sourceEndOffset
    });
    reasons.add(candidate.reason);
  }

  return {
    documentId: document.documentId,
    chunks: selected,
    totalEstimatedTokens: plan.totalEstimatedTokens,
    truncated: plan.truncated,
    retrievalReasons: [...reasons]
  };
}
