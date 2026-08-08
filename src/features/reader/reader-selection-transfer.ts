import {
  isCardType,
  type CardType
} from "../../../shared/card-types";

export const READER_SELECTION_STORAGE_KEY = "aleksi.readerSelection";
export const GRAPH_WORK_STORAGE_KEY = "aleksi.graphWork";

export type DiagnosisTransferContext = {
  diagnosisId: string;
  blockType:
    | "definition"
    | "example"
    | "counterexample"
    | "proof-search"
    | "technical"
    | "expression"
    | "transfer"
    | "emotion";
  manifestation: string;
  assumedProblem: string;
  actualCause: string;
  nextMinimumAction: string;
};

export type ReaderSelectionPayload = {
  source: "reader-selection";
  sourceReadingId: string;
  sourcePath: string;
  concept: string;
  excerpt: string;
  target: "cards" | "diagnosis";
  cardType?: CardType;
  diagnosisContext?: DiagnosisTransferContext;
};

export type GraphWorkStage =
  | "concept"
  | "example"
  | "boundary"
  | "process"
  | "mistake";

export type GraphWorkTransfer = {
  source: "graph-action";
  target: "reader";
  concept: string;
  stage: GraphWorkStage;
  cardType: CardType;
};

function storage(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDiagnosisTransferContext(
  value: unknown
): value is DiagnosisTransferContext {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<DiagnosisTransferContext>;
  return (
    isNonemptyString(candidate.diagnosisId) &&
    typeof candidate.blockType === "string" &&
    [
      "definition",
      "example",
      "counterexample",
      "proof-search",
      "technical",
      "expression",
      "transfer",
      "emotion"
    ].includes(candidate.blockType) &&
    typeof candidate.manifestation === "string" &&
    typeof candidate.assumedProblem === "string" &&
    typeof candidate.actualCause === "string" &&
    typeof candidate.nextMinimumAction === "string"
  );
}

export function isReaderSelectionPayload(
  value: unknown
): value is ReaderSelectionPayload {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ReaderSelectionPayload>;
  if (
    candidate.source !== "reader-selection" ||
    !isNonemptyString(candidate.sourceReadingId) ||
    !isNonemptyString(candidate.sourcePath) ||
    !isNonemptyString(candidate.concept) ||
    !isNonemptyString(candidate.excerpt)
  ) {
    return false;
  }

  if (candidate.target === "cards") {
    return (
      typeof candidate.cardType === "string" &&
      isCardType(candidate.cardType) &&
      (candidate.diagnosisContext === undefined ||
        isDiagnosisTransferContext(candidate.diagnosisContext))
    );
  }

  return candidate.target === "diagnosis";
}

export function readReaderSelectionPayload(options: {
  clearAfterRead?: boolean;
} = {}): ReaderSelectionPayload | null {
  const store = storage();
  const raw = store?.getItem(READER_SELECTION_STORAGE_KEY);
  if (raw === null || raw === undefined) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isReaderSelectionPayload(parsed)) {
      return null;
    }
    if (options.clearAfterRead) {
      store?.removeItem(READER_SELECTION_STORAGE_KEY);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeReaderSelectionPayload(
  payload: ReaderSelectionPayload
): void {
  if (!isReaderSelectionPayload(payload)) {
    throw new Error("Invalid reader selection payload");
  }

  storage()?.setItem(READER_SELECTION_STORAGE_KEY, JSON.stringify(payload));
}

export function clearReaderSelectionPayload(): void {
  storage()?.removeItem(READER_SELECTION_STORAGE_KEY);
}

function isGraphWorkTransfer(value: unknown): value is GraphWorkTransfer {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<GraphWorkTransfer>;
  return (
    candidate.source === "graph-action" &&
    candidate.target === "reader" &&
    isNonemptyString(candidate.concept) &&
    typeof candidate.stage === "string" &&
    ["concept", "example", "boundary", "process", "mistake"].includes(
      candidate.stage
    ) &&
    typeof candidate.cardType === "string" &&
    isCardType(candidate.cardType)
  );
}

export function writeGraphWorkTransfer(payload: GraphWorkTransfer): void {
  if (!isGraphWorkTransfer(payload)) {
    throw new Error("Invalid graph work transfer");
  }
  storage()?.setItem(GRAPH_WORK_STORAGE_KEY, JSON.stringify(payload));
}

export function readGraphWorkTransfer(options: {
  clearAfterRead?: boolean;
} = {}): GraphWorkTransfer | null {
  const store = storage();
  const raw = store?.getItem(GRAPH_WORK_STORAGE_KEY);
  if (raw === null || raw === undefined) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isGraphWorkTransfer(parsed)) return null;
    if (options.clearAfterRead) store?.removeItem(GRAPH_WORK_STORAGE_KEY);
    return parsed;
  } catch {
    return null;
  }
}
