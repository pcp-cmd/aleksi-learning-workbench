import type { ErrorRequestHandler, Response } from "express";
import { ZodError } from "zod";
import { AppSettingsError } from "../config/app-settings";
import { FilenameError } from "../lib/filename";
import { VaultPathError } from "../lib/path-safety";
import {
  httpErrorResponse,
  type HttpErrorRecovery,
  type HttpErrorResponse
} from "./error-response";
import {
  READING_JSON_BODY_LIMIT_BYTES
} from "../../shared/api-limits";
export {
  READING_BODY_JSON_LIMIT_BYTES,
  READING_DETAIL_JSON_LIMIT_BYTES,
  READING_JSON_BODY_LIMIT_BYTES
} from "../../shared/api-limits";

type BodyParserError = Error & {
  payloadTarget?: PayloadLimitTarget;
  status?: number;
  type?: string;
};

type ServiceError = Error & {
  code: string;
  details?: Readonly<{ transactionId?: string }>;
  recovery?: HttpErrorRecovery;
  status: number;
};

export const STANDARD_JSON_BODY_LIMIT_BYTES = 256 * 1024;

export type PayloadLimitTarget = "request_body" | "reading_material";

export function tagPayloadLimitTarget(
  error: unknown,
  payloadTarget: PayloadLimitTarget
): unknown {
  if (error instanceof Error) {
    Object.assign(error, { payloadTarget });
  }
  return error;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return error instanceof Error &&
    "type" in error &&
    error.type === "entity.too.large";
}

function isServiceError(error: unknown): error is ServiceError {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599;
}

export function mapHttpError(error: unknown): HttpErrorResponse {
  if (isBodyParserError(error)) {
    const readingMaterial = error.payloadTarget === "reading_material";
    return httpErrorResponse(
      413,
      "PAYLOAD_TOO_LARGE",
      readingMaterial
        ? "阅读材料太长，请缩短到 2 MiB 以内后再保存。"
        : "请求内容过大，请缩短到 256 KiB 以内后重试。",
      {
        action: "reduce_payload",
        target: readingMaterial ? "reading_material" : "request_body",
        maxBytes: readingMaterial
          ? READING_JSON_BODY_LIMIT_BYTES
          : STANDARD_JSON_BODY_LIMIT_BYTES
      }
    );
  }

  if (error instanceof ZodError) {
    return httpErrorResponse(
      422,
      "INVALID_REQUEST_BODY",
      error.issues.map((issue) => issue.message).join("; "),
      {
        action: "correct_fields",
        fields: error.issues.map((issue) => ({
          path: issue.path.length === 0 ? "$" : issue.path.join("."),
          message: issue.message
        }))
      }
    );
  }

  if (isServiceError(error)) {
    return httpErrorResponse(
      error.status,
      error.code,
      error.message,
      error.recovery,
      error.details
    );
  }

  if (error instanceof FilenameError || error instanceof VaultPathError) {
    return httpErrorResponse(400, error.code, error.message);
  }

  if (error instanceof AppSettingsError) {
    return httpErrorResponse(500, error.code, error.message);
  }

  return httpErrorResponse(
    500,
    "INTERNAL_SERVER_ERROR",
    "Unexpected server error"
  );
}

export function sendHttpError(response: Response, error: unknown): void {
  const failure = mapHttpError(error);
  response.status(failure.status).json(failure.body);
}

export const httpErrorMiddleware: ErrorRequestHandler = (
  error,
  _request,
  response,
  next
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (process.env.NODE_ENV === "development") {
    console.error(error);
  }

  sendHttpError(response, error);
};
