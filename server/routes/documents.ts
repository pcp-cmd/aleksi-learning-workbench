import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../http/async-route";
import { withLibraryOperation } from "../http/library-request";
import { buildAIContextBundle } from "../documents/ai-context-builder";
import { buildDocumentIndex } from "../documents/document-index-store";
import { searchStoredDocument } from "../documents/document-search";
import {
  getDocumentChunk,
  getDocumentDescriptor,
  getStoredDocument,
  relinkDocumentSource,
  resolveDocumentEntry
} from "../documents/document-service";
import { buildDocumentSummaryPlan } from "../documents/document-summary-plan";
import {
  AI_CONTEXT_DEFAULT_BUDGET_TOKENS,
  AI_CONTEXT_MAXIMUM_BUDGET_TOKENS,
  AI_CONTEXT_MINIMUM_BUDGET_TOKENS,
  DOCUMENT_SEARCH_RESULT_LIMIT
} from "../../shared/document-limits";

const documentParamsSchema = z.object({ documentId: z.string().uuid() }).strict();
const chunkParamsSchema = z.object({
  documentId: z.string().uuid(),
  chunkId: z.string().min(1).max(128)
}).strict();
const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().positive().max(DOCUMENT_SEARCH_RESULT_LIMIT).default(DOCUMENT_SEARCH_RESULT_LIMIT)
}).strict();
const aiContextSchema = z.object({
  activeChunkId: z.string().min(1).optional(),
  query: z.string().trim().max(500).optional(),
  selectedRange: z.object({
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive()
  }).strict().optional(),
  mode: z.enum([
    "explain-selection",
    "question-answering",
    "concept-generation",
    "section-summary",
    "document-summary"
  ]),
  budgetTokens: z.number().int()
    .min(AI_CONTEXT_MINIMUM_BUDGET_TOKENS)
    .max(AI_CONTEXT_MAXIMUM_BUDGET_TOKENS)
    .optional()
}).strict();
const summaryQuerySchema = z.object({
  budgetTokens: z.coerce.number().int()
    .min(AI_CONTEXT_MINIMUM_BUDGET_TOKENS)
    .max(AI_CONTEXT_MAXIMUM_BUDGET_TOKENS)
    .default(AI_CONTEXT_DEFAULT_BUDGET_TOKENS)
}).strict();
const relinkSchema = z.object({
  relativePath: z.string().trim().min(1).max(1_024)
}).strict();

export function createDocumentsRouter(): Router {
  const router = Router();

  router.get("/:documentId", asyncRoute(async (request, response) => {
    const params = documentParamsSchema.parse(request.params);
    await withLibraryOperation(request, response, async (context) => {
      response.json({
        document: await getDocumentDescriptor(context, params.documentId)
      });
    });
  }));

  router.get("/:documentId/chunks/:chunkId/content", asyncRoute(async (request, response) => {
    const params = chunkParamsSchema.parse(request.params);
    await withLibraryOperation(request, response, async (context) => {
      const chunk = await getDocumentChunk(context, params.documentId, params.chunkId);
      response.set("Cache-Control", "private, no-store");
      response.type("text/markdown; charset=utf-8").send(chunk.markdown);
    });
  }));

  router.get("/:documentId/search", asyncRoute(async (request, response) => {
    const params = documentParamsSchema.parse(request.params);
    const query = searchQuerySchema.parse(request.query);
    await withLibraryOperation(request, response, async (context) => {
      const document = await getStoredDocument(context, params.documentId);
      response.json({ results: searchStoredDocument(document, query.q, query.limit) });
    });
  }));

  router.post("/:documentId/ai-context", asyncRoute(async (request, response) => {
    const params = documentParamsSchema.parse(request.params);
    const input = aiContextSchema.parse(request.body);
    await withLibraryOperation(request, response, async (context) => {
      const document = await getStoredDocument(context, params.documentId);
      response.json({
        context: await buildAIContextBundle(context, document, {
          ...input,
          documentId: params.documentId
        })
      });
    });
  }));

  router.get("/:documentId/summary-plan", asyncRoute(async (request, response) => {
    const params = documentParamsSchema.parse(request.params);
    const query = summaryQuerySchema.parse(request.query);
    await withLibraryOperation(request, response, async (context) => {
      const document = await getStoredDocument(context, params.documentId);
      response.json({
        plan: buildDocumentSummaryPlan(document, query.budgetTokens)
      });
    });
  }));

  router.post("/:documentId/reindex", asyncRoute(async (request, response) => {
    const params = documentParamsSchema.parse(request.params);
    await withLibraryOperation(request, response, async (context) => {
      const entry = await resolveDocumentEntry(context, params.documentId);
      response.json({ document: await buildDocumentIndex(context, entry) });
    });
  }));

  router.post("/:documentId/relink", asyncRoute(async (request, response) => {
    const params = documentParamsSchema.parse(request.params);
    const input = relinkSchema.parse(request.body);
    await withLibraryOperation(request, response, async (context) => {
      response.json({
        document: await relinkDocumentSource(
          context,
          params.documentId,
          input.relativePath
        )
      });
    });
  }));

  return router;
}
