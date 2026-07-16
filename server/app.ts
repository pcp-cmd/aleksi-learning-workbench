import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express from "express";
import { desktopCorsMiddleware } from "./http/desktop-cors";
import { httpErrorMiddleware } from "./http/error-mapper";
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
  desktopCors?: boolean;
  runtimeLifecycle?: RuntimeLifecycle;
  staticDistDir?: string;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const runtimeLifecycle =
    options.runtimeLifecycle ?? createRuntimeLifecycle();
  const staticDistDir =
    options.staticDistDir === undefined
      ? undefined
      : resolve(options.staticDistDir);

  if (options.desktopCors) {
    app.use("/api", desktopCorsMiddleware);
  }
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/cards", createCardsRouter());
  app.use("/api/codex", createCodexRouter());
  app.use("/api/diagnoses", createDiagnosesRouter());
  app.use("/api/graph", createGraphRouter());
  app.use("/api/index", createIndexRebuildRouter());
  app.use("/api/readings", createReadingsRouter());
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
