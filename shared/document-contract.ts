export const DOCUMENT_REGISTRY_SCHEMA_VERSION = 1;
export const DOCUMENT_PARSER_VERSION = 1;
export const DOCUMENT_INDEX_SCHEMA_VERSION = 1;
export const DOCUMENT_IMPORT_SCHEMA_VERSION = 1;

export type DocumentProcessingStatus =
  | "pending"
  | "processing"
  | "ready"
  | "stale"
  | "failed"
  | "unavailable";

export type DocumentSourceVersion = {
  byteSize: number;
  modifiedNanoseconds: string;
  inode: string;
};

export type DocumentComplexityMetrics = {
  byteSize: number;
  lineCount: number;
  astNodeCount: number;
  headingCount: number;
  paragraphCount: number;
  mathBlockCount: number;
  codeBlockCount: number;
  tableCount: number;
  estimatedRenderedNodeCount: number;
  estimatedTokens: number;
  maximumSingleBlockBytes: number;
};

export type DocumentComplexity = {
  mode: "standard" | "large";
  reasons: string[];
  metrics: DocumentComplexityMetrics;
};

export type DocumentOutlineNode = {
  nodeId: string;
  documentId: string;
  chunkId: string;
  title: string;
  level: number;
  sourceStartOffset: number;
  sourceStartLine: number;
  children: DocumentOutlineNode[];
};

export type DocumentChunkMetadata = {
  chunkId: string;
  documentId: string;
  title?: string;
  headingLevel?: number;
  headingPath: string[];
  sourceStartOffset: number;
  sourceEndOffset: number;
  sourceStartLine: number;
  sourceEndLine: number;
  contentHash: string;
  estimatedTokens: number;
  oversized: boolean;
  previousChunkId?: string;
  nextChunkId?: string;
};

export type StoredDocumentChunk = DocumentChunkMetadata & {
  plainText: string;
};

export type DocumentRegistryEntry = {
  documentId: string;
  readingId: string;
  relativePath: string;
  title: string;
  concept: string;
  source: "manual-paste" | "file-import" | "legacy";
  sourceFileName?: string;
  createdAt: string;
};

export type DocumentRegistry = {
  schemaVersion: typeof DOCUMENT_REGISTRY_SCHEMA_VERSION;
  vaultId: string;
  documents: DocumentRegistryEntry[];
};

export type StoredDocumentIndex = {
  schemaVersion: typeof DOCUMENT_INDEX_SCHEMA_VERSION;
  parserVersion: typeof DOCUMENT_PARSER_VERSION;
  documentId: string;
  sourcePath: string;
  sourceHash: string;
  sourceVersion: DocumentSourceVersion;
  title: string;
  byteSize: number;
  lineCount: number;
  outline: DocumentOutlineNode[];
  chunks: StoredDocumentChunk[];
  definitionMarkdown: string;
  complexity: DocumentComplexity;
  processingStatus: "ready";
  indexedAt: string;
  diagnostics: string[];
};

export type LearningDocumentDescriptor = Omit<
  StoredDocumentIndex,
  "chunks" | "definitionMarkdown"
> & {
  chunks: DocumentChunkMetadata[];
};

export type DocumentChunkContent = DocumentChunkMetadata & {
  markdown: string;
};

export type DocumentSearchResult = {
  documentId: string;
  chunkId: string;
  headingPath: string[];
  preview: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  sourceStartLine: number;
  sourceEndLine: number;
  score?: number;
};

export type AIContextMode =
  | "explain-selection"
  | "question-answering"
  | "concept-generation"
  | "section-summary"
  | "document-summary";

export type AIContextRequest = {
  documentId: string;
  activeChunkId?: string;
  query?: string;
  selectedRange?: { startOffset: number; endOffset: number };
  mode: AIContextMode;
  budgetTokens?: number;
};

export type AIContextBundle = {
  documentId: string;
  chunks: Array<{
    chunkId: string;
    headingPath: string[];
    content: string;
    estimatedTokens: number;
    sourceStartOffset: number;
    sourceEndOffset: number;
  }>;
  totalEstimatedTokens: number;
  truncated: boolean;
  retrievalReasons: string[];
};

export type DocumentSummaryBatch = {
  batchId: string;
  level: "section" | "chapter" | "document";
  inputChunkIds: string[];
  headingPath: string[];
  estimatedTokens: number;
  dependsOn: string[];
};

export type DocumentSummaryPlan = {
  documentId: string;
  sourceHash: string;
  batches: DocumentSummaryBatch[];
  omittedOverBudgetChunkIds: string[];
};

export type DocumentImportStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "failed";

export type DocumentImportSession = {
  schemaVersion: typeof DOCUMENT_IMPORT_SCHEMA_VERSION;
  sessionId: string;
  vaultId: string;
  fileName: string;
  expectedBytes: number;
  receivedBytes: number;
  title: string;
  concept: string;
  conflictMode: "create-new" | "replace";
  replaceReadingId?: string;
  expectedVersion?: {
    sha256: string;
    size: number;
    mtimeNs: string;
    inode: string;
  };
  status: DocumentImportStatus;
  stage:
    | "reading-material"
    | "analyzing-structure"
    | "preparing-sections"
    | "building-search-index"
    | "ready";
  createdAt: string;
  updatedAt: string;
  error?: string;
  documentId?: string;
  relativePath?: string;
};
