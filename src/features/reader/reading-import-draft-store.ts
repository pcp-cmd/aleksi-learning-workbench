import { activeLibraryDraftKey } from "../../lib/active-library-drafts";
import { createDraftStore } from "../../lib/draft-store";

export type ReadingImportDraft = {
  body: string;
  title: string;
  titleEdited: boolean;
  source: "manual-paste" | "file-import";
  fileName: string | null;
  fileWarning: string | null;
};

function isReadingImportDraft(value: unknown): value is ReadingImportDraft {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.body === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.titleEdited === "boolean" &&
    (candidate.source === "manual-paste" || candidate.source === "file-import") &&
    (candidate.fileName === null || typeof candidate.fileName === "string") &&
    (candidate.fileWarning === null || typeof candidate.fileWarning === "string")
  );
}

const store = createDraftStore<ReadingImportDraft>({
  key: "reading-import",
  maxBytes: 1_024 * 1_024,
  validate: isReadingImportDraft
});

export function readReadingImportDraft(): ReadingImportDraft | null {
  return store.read(activeLibraryDraftKey())?.payload ?? null;
}

export function writeReadingImportDraft(draft: ReadingImportDraft): void {
  store.write(activeLibraryDraftKey(), draft);
}

export function clearReadingImportDraft(): void {
  store.clear(activeLibraryDraftKey());
}
