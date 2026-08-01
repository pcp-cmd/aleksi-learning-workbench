import { createHash } from "node:crypto";
import type {
  DocumentSummaryBatch,
  DocumentSummaryPlan,
  StoredDocumentIndex
} from "../../shared/document-contract";

function batchId(documentId: string, level: string, values: readonly string[]): string {
  return `summary-${createHash("sha256")
    .update(`${documentId}\u0000${level}\u0000${values.join("\u0000")}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function buildDocumentSummaryPlan(
  document: StoredDocumentIndex,
  budgetTokens: number
): DocumentSummaryPlan {
  const safeBudget = Math.max(512, Math.floor(budgetTokens * 0.8));
  const sections: DocumentSummaryBatch[] = [];
  const omittedOverBudgetChunkIds: string[] = [];
  let currentIds: string[] = [];
  let currentTokens = 0;
  let currentHeading: string[] = [];
  const flush = () => {
    if (currentIds.length === 0) return;
    sections.push({
      batchId: batchId(document.documentId, "section", currentIds),
      level: "section",
      inputChunkIds: currentIds,
      headingPath: currentHeading,
      estimatedTokens: currentTokens,
      dependsOn: []
    });
    currentIds = [];
    currentTokens = 0;
    currentHeading = [];
  };
  for (const chunk of document.chunks) {
    if (chunk.estimatedTokens > safeBudget) {
      flush();
      omittedOverBudgetChunkIds.push(chunk.chunkId);
      continue;
    }
    if (currentIds.length > 0 && currentTokens + chunk.estimatedTokens > safeBudget) flush();
    currentIds.push(chunk.chunkId);
    currentTokens += chunk.estimatedTokens;
    if (currentHeading.length === 0) currentHeading = chunk.headingPath;
  }
  flush();

  const chapterGroups = new Map<string, DocumentSummaryBatch[]>();
  for (const section of sections) {
    const chapter = section.headingPath[0] ?? document.title;
    const list = chapterGroups.get(chapter) ?? [];
    list.push(section);
    chapterGroups.set(chapter, list);
  }
  const chapters = [...chapterGroups.entries()].map(([chapter, inputs]) => ({
    batchId: batchId(document.documentId, "chapter", inputs.map((item) => item.batchId)),
    level: "chapter" as const,
    inputChunkIds: inputs.flatMap((item) => item.inputChunkIds),
    headingPath: [chapter],
    estimatedTokens: Math.max(1, Math.ceil(inputs.reduce((sum, item) => sum + item.estimatedTokens, 0) / 8)),
    dependsOn: inputs.map((item) => item.batchId)
  }));
  const complete: DocumentSummaryBatch = {
    batchId: batchId(document.documentId, "document", chapters.map((item) => item.batchId)),
    level: "document",
    inputChunkIds: sections.flatMap((section) => section.inputChunkIds),
    headingPath: [document.title],
    estimatedTokens: Math.max(1, Math.ceil(chapters.reduce((sum, item) => sum + item.estimatedTokens, 0) / 4)),
    dependsOn: chapters.map((item) => item.batchId)
  };
  return {
    documentId: document.documentId,
    sourceHash: document.sourceHash,
    batches: [...sections, ...chapters, complete],
    omittedOverBudgetChunkIds
  };
}
