import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../http/async-route";
import {
  createReadingInVault,
  getReadingAssetByIdInVault,
  getReadingByIdInVault,
  listReadingsInVault,
  ReadingInputSchema
} from "../services/reading-service";
import { ReadingServiceError } from "../services/reading-service";
import {
  READING_BODY_JSON_LIMIT_BYTES,
  READING_DETAIL_JSON_LIMIT_BYTES
} from "../../shared/api-limits";
import { withLibraryOperation } from "../http/library-request";

const readingIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
const readingAssetQuerySchema = z.object({ path: z.string().min(1) }).strict();

export function createReadingsRouter(): Router {
  const router = Router();

  router.post(
    "/",
    asyncRoute(async (request, response) => {
      const input = ReadingInputSchema.parse(request.body);
      await withLibraryOperation(request, response, async (context) => {
        response.json(await createReadingInVault(context, input));
      });
    })
  );

  router.get(
    "/",
    asyncRoute(async (request, response) => {
      await withLibraryOperation(request, response, async (context) => {
        response.json({
          readings: await listReadingsInVault(context)
        });
      });
    })
  );

  router.get(
    "/:id/media",
    asyncRoute(async (request, response) => {
      const params = readingIdParamsSchema.parse(request.params);
      const query = readingAssetQuerySchema.parse(request.query);
      await withLibraryOperation(request, response, async (context) => {
        const asset = await getReadingAssetByIdInVault(
          context,
          params.id,
          query.path
        );
        response.set("Cache-Control", "private, no-store");
        response.type(asset.mimeType).send(asset.data);
      });
    })
  );

  router.get(
    "/:id",
    asyncRoute(async (request, response) => {
      const params = readingIdParamsSchema.parse(request.params);
      await withLibraryOperation(request, response, async (context) => {
        const payload = {
          reading: await getReadingByIdInVault(context, params.id)
        };
        if (
          Buffer.byteLength(JSON.stringify(payload), "utf8") >
          READING_DETAIL_JSON_LIMIT_BYTES
        ) {
          throw new ReadingServiceError(
            "READING_RESPONSE_TOO_LARGE",
            "Reading response is too large to return safely",
            413,
            {
              action: "reduce_payload",
              target: "reading_material",
              maxBytes: READING_BODY_JSON_LIMIT_BYTES
            }
          );
        }
        response.json(payload);
      });
    })
  );

  return router;
}
