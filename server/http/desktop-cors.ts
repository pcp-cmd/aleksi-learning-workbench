import type { RequestHandler } from "express";

const DESKTOP_ORIGINS = new Set([
  "http://tauri.localhost",
  "tauri://localhost"
]);

export const desktopCorsMiddleware: RequestHandler = (
  request,
  response,
  next
) => {
  const origin = request.get("Origin");
  if (origin === undefined) {
    next();
    return;
  }

  if (!DESKTOP_ORIGINS.has(origin)) {
    response.status(403).json({
      error: {
        code: "DESKTOP_ORIGIN_FORBIDDEN",
        message: "Desktop API origin is not allowed"
      }
    });
    return;
  }

  response.set({
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  });

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  next();
};
