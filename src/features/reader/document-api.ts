import type {
  DocumentSearchResult,
  LearningDocumentDescriptor
} from "../../../shared/document-contract";
import { DOCUMENT_CHUNK_RESPONSE_MAX_BYTES } from "../../../shared/document-limits";
import { apiClient } from "../../lib/api-client";

export type DocumentDescriptorResponse = {
  document: LearningDocumentDescriptor;
};

export type DocumentSearchResponse = {
  results: DocumentSearchResult[];
};

export function loadDocumentDescriptor(documentId: string, signal?: AbortSignal) {
  return apiClient.get<DocumentDescriptorResponse>(
    `/api/documents/${encodeURIComponent(documentId)}`,
    { signal }
  );
}
export function loadDocumentChunk(
  documentId: string,
  chunkId: string,
  signal?: AbortSignal
) {
  return apiClient.getText(
    `/api/documents/${encodeURIComponent(documentId)}/chunks/${encodeURIComponent(chunkId)}/content`,
    {
      signal,
      allowedMimeTypes: ["text/markdown"],
      maxBytes: DOCUMENT_CHUNK_RESPONSE_MAX_BYTES
    }
  );
}

export function searchDocument(
  documentId: string,
  query: string,
  signal?: AbortSignal
) {
  return apiClient.get<DocumentSearchResponse>(
    `/api/documents/${encodeURIComponent(documentId)}/search?q=${encodeURIComponent(query)}`,
    { signal }
  );
}
