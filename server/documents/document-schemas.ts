import { z } from "zod";
import {
  DOCUMENT_IMPORT_SCHEMA_VERSION,
  DOCUMENT_INDEX_SCHEMA_VERSION,
  DOCUMENT_PARSER_VERSION,
  DOCUMENT_REGISTRY_SCHEMA_VERSION
} from "../../shared/document-contract";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const safeIntegerSchema = z.number().int().nonnegative().safe();

const sourceVersionSchema = z.object({
  byteSize: safeIntegerSchema,
  modifiedNanoseconds: z.string().regex(/^\d+$/u),
  inode: z.string().regex(/^\d+$/u)
}).strict();

const assetVersionSchema = z.object({
  sha256: sha256Schema,
  size: safeIntegerSchema,
  mtimeNs: z.string().regex(/^\d+$/u),
  inode: z.string().regex(/^\d+$/u)
}).strict();

const chunkSchema = z.object({
  chunkId: z.string().regex(/^chunk-[0-9a-f]{24}-\d+$/u),
  documentId: z.string().uuid(),
  title: z.string().min(1).optional(),
  headingLevel: z.number().int().min(1).max(6).optional(),
  headingPath: z.array(z.string()),
  sourceStartOffset: safeIntegerSchema,
  sourceEndOffset: safeIntegerSchema,
  sourceStartLine: z.number().int().positive(),
  sourceEndLine: z.number().int().positive(),
  contentHash: sha256Schema,
  estimatedTokens: z.number().int().positive(),
  oversized: z.boolean(),
  previousChunkId: z.string().optional(),
  nextChunkId: z.string().optional(),
  plainText: z.string()
}).strict();

type OutlineInput = {
  nodeId: string;
  documentId: string;
  chunkId: string;
  title: string;
  level: number;
  sourceStartOffset: number;
  sourceStartLine: number;
  children: OutlineInput[];
};

const outlineSchema: z.ZodType<OutlineInput> = z.lazy(() => z.object({
  nodeId: z.string(),
  documentId: z.string().uuid(),
  chunkId: z.string(),
  title: z.string().min(1),
  level: z.number().int().min(1).max(6),
  sourceStartOffset: safeIntegerSchema,
  sourceStartLine: z.number().int().positive(),
  children: z.array(outlineSchema)
}).strict());

const metricsSchema = z.object({
  byteSize: safeIntegerSchema,
  lineCount: safeIntegerSchema,
  astNodeCount: safeIntegerSchema,
  headingCount: safeIntegerSchema,
  paragraphCount: safeIntegerSchema,
  mathBlockCount: safeIntegerSchema,
  codeBlockCount: safeIntegerSchema,
  tableCount: safeIntegerSchema,
  estimatedRenderedNodeCount: safeIntegerSchema,
  estimatedTokens: safeIntegerSchema,
  maximumSingleBlockBytes: safeIntegerSchema
}).strict();

export const storedDocumentIndexSchema = z.object({
  schemaVersion: z.literal(DOCUMENT_INDEX_SCHEMA_VERSION),
  parserVersion: z.literal(DOCUMENT_PARSER_VERSION),
  documentId: z.string().uuid(),
  sourcePath: z.string().min(1),
  sourceHash: sha256Schema,
  sourceVersion: sourceVersionSchema,
  title: z.string().min(1),
  byteSize: safeIntegerSchema,
  lineCount: safeIntegerSchema,
  outline: z.array(outlineSchema),
  chunks: z.array(chunkSchema).min(1),
  definitionMarkdown: z.string(),
  complexity: z.object({
    mode: z.enum(["standard", "large"]),
    reasons: z.array(z.string()),
    metrics: metricsSchema
  }).strict(),
  processingStatus: z.literal("ready"),
  indexedAt: z.string().datetime(),
  diagnostics: z.array(z.string())
}).strict();

export const registryEntrySchema = z.object({
  documentId: z.string().uuid(),
  readingId: z.string().uuid(),
  relativePath: z.string().min(1),
  title: z.string().min(1),
  concept: z.string().min(1),
  source: z.enum(["manual-paste", "file-import", "legacy"]),
  sourceFileName: z.string().min(1).optional(),
  createdAt: z.string().datetime()
}).strict();

export const documentRegistrySchema = z.object({
  schemaVersion: z.literal(DOCUMENT_REGISTRY_SCHEMA_VERSION),
  vaultId: z.string().uuid(),
  documents: z.array(registryEntrySchema)
}).strict();

export const documentImportSessionSchema = z.object({
  schemaVersion: z.literal(DOCUMENT_IMPORT_SCHEMA_VERSION),
  sessionId: z.string().uuid(),
  vaultId: z.string().uuid(),
  fileName: z.string().min(1),
  expectedBytes: safeIntegerSchema,
  receivedBytes: safeIntegerSchema,
  title: z.string().min(1),
  concept: z.string().min(1),
  conflictMode: z.enum(["create-new", "replace"]),
  replaceReadingId: z.string().uuid().optional(),
  expectedVersion: assetVersionSchema.optional(),
  status: z.enum(["uploading", "processing", "ready", "failed"]),
  stage: z.enum([
    "reading-material",
    "analyzing-structure",
    "preparing-sections",
    "building-search-index",
    "ready"
  ]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  error: z.string().optional(),
  documentId: z.string().uuid().optional(),
  relativePath: z.string().min(1).optional()
}).strict();
