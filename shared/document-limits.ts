export const DOCUMENT_IMPORT_PART_BYTES = 512 * 1024;
export const DOCUMENT_IMPORT_PREVIEW_BYTES = 64 * 1024;
export const DOCUMENT_MAX_SOURCE_BYTES = 128 * 1024 * 1024;
// Keep ordinary semantic chunks below the default AI context budget after
// safety margin. Individual structural blocks may exceed this and are marked
// `oversized` rather than sliced through Markdown syntax.
export const DOCUMENT_CHUNK_TARGET_BYTES = 32 * 1024;
export const DOCUMENT_CHUNK_SOFT_MAX_BYTES = 64 * 1024;
export const DOCUMENT_CHUNK_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
export const DOCUMENT_READER_NEIGHBOR_COUNT = 1;
export const DOCUMENT_SEARCH_RESULT_LIMIT = 50;
export const DOCUMENT_SEARCH_PREVIEW_CHARACTERS = 180;

export const DOCUMENT_COMPLEXITY_THRESHOLDS = Object.freeze({
  byteSize: 2 * 1024 * 1024,
  lineCount: 20_000,
  astNodeCount: 25_000,
  estimatedRenderedNodeCount: 20_000,
  estimatedTokens: 300_000,
  maximumSingleBlockBytes: DOCUMENT_CHUNK_SOFT_MAX_BYTES,
  mathBlockCount: 2_000,
  codeBlockCount: 1_000,
  tableCount: 500
});

export const AI_CONTEXT_DEFAULT_BUDGET_TOKENS = 16_000;
export const AI_CONTEXT_MINIMUM_BUDGET_TOKENS = 512;
export const AI_CONTEXT_MAXIMUM_BUDGET_TOKENS = 200_000;
export const AI_CONTEXT_SAFETY_MARGIN_RATIO = 0.15;
