import { createHash } from "node:crypto";
import type { DocumentRegistryEntry } from "../../shared/document-contract";
import type {
  IndexEntry,
  MarkdownCandidate
} from "../services/index-contract";

export function documentAwareSourceFingerprint(
  candidates: readonly MarkdownCandidate[],
  todayUtcDate: string,
  registeredDocuments: readonly DocumentRegistryEntry[] = []
): string {
  const hash = createHash("sha256");
  hash.update(`aleksi-index-v1\0${todayUtcDate}\0`, "utf8");
  for (const candidate of candidates) {
    for (const value of [
      candidate.relativePath,
      candidate.size,
      candidate.device,
      candidate.inode,
      candidate.modifiedNanoseconds,
      candidate.changedNanoseconds
    ]) {
      hash.update(String(value), "utf8");
      hash.update("\0", "utf8");
    }
  }
  for (const document of registeredDocuments) {
    for (const value of [
      "registry",
      document.documentId,
      document.relativePath,
      document.title,
      document.concept
    ]) {
      hash.update(value, "utf8");
      hash.update("\0", "utf8");
    }
  }
  return hash.digest("hex");
}

export function registeredReadingIndexEntry(
  document: DocumentRegistryEntry,
  candidate?: MarkdownCandidate
): IndexEntry {
  return {
    id: document.readingId,
    assetType: "reading",
    title: document.title,
    concept: document.concept,
    relativePath: document.relativePath,
    mastery: null,
    nextReview: null,
    createdAt: document.createdAt,
    updatedAt: candidate?.modifiedAt ?? document.createdAt,
    archived: false
  };
}
