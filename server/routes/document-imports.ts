import express, { Router } from "express";
import { z } from "zod";
import { DOCUMENT_IMPORT_PART_BYTES } from "../../shared/document-limits";
import {
  appendDocumentImportPart,
  createDocumentImportSchema,
  createDocumentImportSession,
  finalizeDocumentImport,
  readDocumentImportSession,
  verifyDocumentImportPart
} from "../documents/document-import-service";
import { asyncRoute } from "../http/async-route";
import { withLibraryOperation } from "../http/library-request";

const sessionParamsSchema = z.object({ sessionId: z.string().uuid() }).strict();
const partQuerySchema = z.object({ offset: z.coerce.number().int().nonnegative() }).strict();

export function createDocumentImportsRouter(): Router {
  const router = Router();
  const json = express.json({ limit: 64 * 1024 });
  const raw = express.raw({
    type: "application/octet-stream",
    limit: DOCUMENT_IMPORT_PART_BYTES
  });

  router.post("/", json, asyncRoute(async (request, response) => {
    const input = createDocumentImportSchema.parse(request.body);
    await withLibraryOperation(request, response, async (context) => {
      response.status(201).json({
        session: await createDocumentImportSession(context, input)
      });
    });
  }));

  router.get("/:sessionId", asyncRoute(async (request, response) => {
    const params = sessionParamsSchema.parse(request.params);
    await withLibraryOperation(request, response, async (context) => {
      response.json({
        session: await readDocumentImportSession(context, params.sessionId)
      });
    });
  }));

  router.put("/:sessionId/parts", raw, asyncRoute(async (request, response) => {
    const params = sessionParamsSchema.parse(request.params);
    const query = partQuerySchema.parse(request.query);
    if (!Buffer.isBuffer(request.body)) {
      throw new TypeError("Document import part must be binary data");
    }
    await withLibraryOperation(request, response, async (context) => {
      response.json({
        session: await appendDocumentImportPart(
          context,
          params.sessionId,
          query.offset,
          request.body
        )
      });
    });
  }));

  router.put("/:sessionId/verify-parts", raw, asyncRoute(async (request, response) => {
    const params = sessionParamsSchema.parse(request.params);
    const query = partQuerySchema.parse(request.query);
    if (!Buffer.isBuffer(request.body)) {
      throw new TypeError("Document import verification part must be binary data");
    }
    await withLibraryOperation(request, response, async (context) => {
      response.json({
        session: await verifyDocumentImportPart(
          context,
          params.sessionId,
          query.offset,
          request.body
        )
      });
    });
  }));

  router.post("/:sessionId/finalize", json, asyncRoute(async (request, response) => {
    const params = sessionParamsSchema.parse(request.params);
    await withLibraryOperation(request, response, async (context) => {
      response.json(await finalizeDocumentImport(context, params.sessionId));
    });
  }));

  return router;
}
