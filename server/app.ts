import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type RequestHandler } from "express";
import { desktopProtocolMiddleware } from "./http/desktop-cors";
import {
  httpErrorMiddleware,
  READING_JSON_BODY_LIMIT_BYTES,
  STANDARD_JSON_BODY_LIMIT_BYTES,
  tagPayloadLimitTarget,
  type PayloadLimitTarget
} from "./http/error-mapper";
import { createCardsRouter } from "./routes/cards";
import { createCodexRouter } from "./routes/codex";
import { createDiagnosesRouter } from "./routes/diagnoses";
import { createGraphRouter } from "./routes/graph";
import { createIndexRebuildRouter } from "./routes/index-rebuild";
import { createReadingsRouter } from "./routes/readings";
import { createReviewRouter } from "./routes/review";
import { createRuntimeRouter } from "./routes/runtime";
import { createTodayRouter } from "./routes/today";
import { createVaultRouter } from "./routes/vault";
import { createVerificationRouter } from "./routes/verification";
import {
  createRuntimeLifecycle,
  type RuntimeLifecycle
} from "./runtime/lifecycle";

type CreateAppOptions = {
  desktopProtocolSecret?: string;
  runtimeLifecycle?: RuntimeLifecycle;
  staticDistDir?: string;
};

function scopedJsonBodyParser(
  limit: number,
  payloadTarget: PayloadLimitTarget
): RequestHandler {
  const parser = express.json({ limit });
  return (request, response, next) => {
    parser(request, response, (error?: unknown) => {
      next(
        error === undefined
          ? undefined
          : tagPayloadLimitTarget(error, payloadTarget)
      );
    });
  };
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const runtimeLifecycle =
    options.runtimeLifecycle ?? createRuntimeLifecycle();
  const staticDistDir =
    options.staticDistDir === undefined
      ? undefined
      : resolve(options.staticDistDir);

  if (options.desktopProtocolSecret !== undefined) {
    app.use(
      "/api",
      desktopProtocolMiddleware(options.desktopProtocolSecret)
    );
  }
  app.use(
    "/api/readings",
    scopedJsonBodyParser(
      READING_JSON_BODY_LIMIT_BYTES,
      "reading_material"
    ),
    createReadingsRouter()
  );
  app.use(
    "/api",
    scopedJsonBodyParser(STANDARD_JSON_BODY_LIMIT_BYTES, "request_body")
  );
  app.use("/api/cards", createCardsRouter());
  app.use("/api/codex", createCodexRouter());
  app.use("/api/diagnoses", createDiagnosesRouter());
  app.use("/api/graph", createGraphRouter());
  app.use("/api/index", createIndexRebuildRouter());
  app.use("/api/review", createReviewRouter());
  app.use("/api/runtime", createRuntimeRouter(runtimeLifecycle));
  app.use("/api/today", createTodayRouter());
  app.use("/api/vault", createVaultRouter());
  app.use("/api/verification", createVerificationRouter());
  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "aleksi-workbench",
      ...runtimeLifecycle.identity
    });
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({
      error: {
        code: "API_ROUTE_NOT_FOUND",
        message: "未找到本地服务接口"
      }
    });
  });

  if (staticDistDir !== undefined) {
    const indexPath = join(staticDistDir, "index.html");

    app.use(express.static(staticDistDir, { index: false }));
    app.get(/^\/(?!api(?:\/|$)).*/u, (_request, response, next) => {
      if (!existsSync(indexPath)) {
        next();
        return;
      }

      response.sendFile(indexPath, (error) => {
        if (error) {
          next(error);
        }
      });
    });
  }

  app.use(httpErrorMiddleware);

  return app;
}
