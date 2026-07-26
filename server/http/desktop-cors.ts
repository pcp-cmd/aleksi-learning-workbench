import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const DESKTOP_ORIGINS = new Set([
  "http://tauri.localhost",
  "tauri://localhost"
]);

export const DESKTOP_PROTOCOL_SECRET_HEADER =
  "X-Aleksi-Protocol-Secret";

const PROTOCOL_SECRET = /^[a-f0-9]{64}$/u;

function secretDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authenticatedSecret(
  candidate: string | undefined,
  expectedDigest: Buffer
): boolean {
  if (candidate === undefined) {
    return false;
  }

  const matches = timingSafeEqual(secretDigest(candidate), expectedDigest);
  return PROTOCOL_SECRET.test(candidate) && matches;
}

function sendProtocolError(
  response: Parameters<RequestHandler>[1],
  status: number,
  code: string,
  message: string
): void {
  response.status(status).json({ error: { code, message } });
}

export function desktopProtocolMiddleware(secret: string): RequestHandler {
  if (!PROTOCOL_SECRET.test(secret)) {
    throw new Error(
      "Desktop protocol secret must be 64 lowercase hexadecimal characters"
    );
  }

  const expectedDigest = secretDigest(secret);

  return (request, response, next) => {
    const origin = request.get("Origin");
    if (origin === undefined) {
      sendProtocolError(
        response,
        403,
        "DESKTOP_ORIGIN_REQUIRED",
        "Desktop API requests require an approved origin"
      );
      return;
    }

    if (!DESKTOP_ORIGINS.has(origin)) {
      sendProtocolError(
        response,
        403,
        "DESKTOP_ORIGIN_FORBIDDEN",
        "Desktop API origin is not allowed"
      );
      return;
    }

    response.set({
      "Access-Control-Allow-Headers":
        `Content-Type, ${DESKTOP_PROTOCOL_SECRET_HEADER}`,
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Max-Age": "600"
    });
    response.vary("Origin");

    // Browser preflights carry no application data and cannot include the
    // secret value. Origin validation above is therefore the whole exception.
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }

    const candidate = request.get(DESKTOP_PROTOCOL_SECRET_HEADER);
    if (candidate === undefined) {
      sendProtocolError(
        response,
        401,
        "DESKTOP_AUTH_REQUIRED",
        "Desktop API authentication is required"
      );
      return;
    }
    if (!authenticatedSecret(candidate, expectedDigest)) {
      sendProtocolError(
        response,
        401,
        "DESKTOP_AUTH_INVALID",
        "Desktop API authentication failed"
      );
      return;
    }

    next();
  };
}
