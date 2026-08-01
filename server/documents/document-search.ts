import {
  DOCUMENT_SEARCH_PREVIEW_CHARACTERS,
  DOCUMENT_SEARCH_RESULT_LIMIT
} from "../../shared/document-limits";
import type {
  DocumentSearchResult,
  StoredDocumentIndex
} from "../../shared/document-contract";

function normalized(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("zh-CN");
}

function previewAround(value: string, index: number, queryLength: number): string {
  const radius = Math.floor((DOCUMENT_SEARCH_PREVIEW_CHARACTERS - queryLength) / 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(value.length, index + queryLength + radius);
  return `${start > 0 ? "…" : ""}${value.slice(start, end).replace(/\s+/gu, " ")}${
    end < value.length ? "…" : ""
  }`;
}

export function searchStoredDocument(
  document: StoredDocumentIndex,
  query: string,
  requestedLimit = DOCUMENT_SEARCH_RESULT_LIMIT
): DocumentSearchResult[] {
  const trimmed = query.trim().normalize("NFC");
  if (trimmed.length === 0 || trimmed.length > 200) {
    return [];
  }
  const limit = Math.max(1, Math.min(requestedLimit, DOCUMENT_SEARCH_RESULT_LIMIT));
  const needle = normalized(trimmed);
  const results: DocumentSearchResult[] = [];

  for (const chunk of document.chunks) {
    const heading = chunk.headingPath.join(" ");
    const headingMatch = normalized(heading).indexOf(needle);
    if (headingMatch >= 0 && results.length < limit) {
      results.push({
        documentId: document.documentId,
        chunkId: chunk.chunkId,
        headingPath: chunk.headingPath,
        preview: previewAround(heading, headingMatch, trimmed.length),
        sourceStartOffset: chunk.sourceStartOffset,
        sourceEndOffset: chunk.sourceEndOffset,
        sourceStartLine: chunk.sourceStartLine,
        sourceEndLine: chunk.sourceEndLine,
        score: 2
      });
    }
    const searchable = normalized(chunk.plainText);
    let from = 0;
    while (results.length < limit) {
      const match = searchable.indexOf(needle, from);
      if (match < 0) break;
      results.push({
        documentId: document.documentId,
        chunkId: chunk.chunkId,
        headingPath: chunk.headingPath,
        preview: previewAround(chunk.plainText, Math.min(match, chunk.plainText.length), trimmed.length),
        sourceStartOffset: chunk.sourceStartOffset,
        sourceEndOffset: chunk.sourceEndOffset,
        sourceStartLine: chunk.sourceStartLine,
        sourceEndLine: chunk.sourceEndLine,
        score: 1
      });
      from = match + Math.max(1, needle.length);
    }
    if (results.length >= limit) break;
  }
  return results.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}
