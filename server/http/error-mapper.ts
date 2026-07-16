import type { ErrorRequestHandler, Response } from "express";
import { ZodError } from "zod";
import { AppSettingsError } from "../config/app-settings";
import { FilenameError } from "../lib/filename";
import { VaultPathError } from "../lib/path-safety";
import {
  httpErrorResponse,
  type HttpErrorResponse
} from "./error-response";

type BodyParserError = Error & {
  status?: number;
  type?: string;
};

type ServiceError = Error & {
  code: string;
  status: number;
};

function isBodyParserError(error: unknown): error is BodyParserError {
  return error instanceof Error && (
    ("type" in error && error.type === "entity.too.large") ||
    ("status" in error && error.status === 413)
  );
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
    return httpErrorResponse(
      413,
      "PAYLOAD_TOO_LARGE",
      "阅读材料太长，请缩短到 10MB 以内后再保存。"
    );
  }

  if (error instanceof ZodError) {
    return httpErrorResponse(
      400,
      "INVALID_REQUEST_BODY",
      error.issues.map((issue) => issue.message).join("; ")
    );
  }

  if (isServiceError(error)) {
    return httpErrorResponse(error.status, error.code, error.message);
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
