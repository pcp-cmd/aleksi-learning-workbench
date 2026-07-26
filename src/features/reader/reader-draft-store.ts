import { activeLibraryDraftKey } from "../../lib/active-library-drafts";
import { createDraftStore } from "../../lib/draft-store";

export type ReaderStateDraft = {
  selectedReadingId: string | null;
  scrollTop: number;
};

function isReaderStateDraft(value: unknown): value is ReaderStateDraft {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.selectedReadingId === null ||
      typeof candidate.selectedReadingId === "string") &&
    typeof candidate.scrollTop === "number" &&
    Number.isFinite(candidate.scrollTop) &&
    candidate.scrollTop >= 0
  );
}

const readerStateStore = createDraftStore<ReaderStateDraft>({
  key: "reader-state",
  validate: isReaderStateDraft
});

export function readReaderStateDraft(): ReaderStateDraft | null {
  return readerStateStore.read(activeLibraryDraftKey())?.payload ?? null;
}

export function writeReaderStateDraft(draft: ReaderStateDraft): void {
  readerStateStore.write(activeLibraryDraftKey(), draft, {
    sourceIds: draft.selectedReadingId === null ? [] : [draft.selectedReadingId]
  });
}
