import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import {
  libraryLeaseManager,
  type LibraryLease,
  type LibraryLeaseManager
} from "../persistence/library-lease";
import type {
  LibraryContext,
  LibraryOperationContext
} from "../persistence/library-context";

type LibraryLocals = {
  libraryAbort?: AbortController;
  libraryLeases?: LibraryLeaseManager;
  libraryOperationActive?: boolean;
};

export const LIBRARY_INSTANCE_ID = randomUUID();

export function setLibraryIdentityHeaders(
  response: Response,
  context: Pick<LibraryContext, "vaultId" | "generation">
): void {
  response.set("X-Aleksi-Library-Instance", LIBRARY_INSTANCE_ID);
  response.set("X-Aleksi-Vault-Id", context.vaultId);
  response.set("X-Aleksi-Vault-Generation", String(context.generation));
}

export function libraryRequestMiddleware(
  leases: LibraryLeaseManager = libraryLeaseManager
): RequestHandler {
  return (request, response, next) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortOnEarlyClose = () => {
      if (!response.writableEnded) {
        controller.abort();
      }
    };
    const removeListeners = () => {
      request.removeListener("aborted", abort);
      response.removeListener("close", abortOnEarlyClose);
    };
    request.once("aborted", abort);
    response.once("close", abortOnEarlyClose);
    const locals = response.locals as LibraryLocals;
    locals.libraryAbort = controller;
    locals.libraryLeases = leases;
    response.once("finish", removeListeners);
    response.once("close", removeListeners);
    next();
  };
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

export async function withLibraryOperation<T>(
  request: Request,
  response: Response,
  operation: (context: LibraryOperationContext) => Promise<T>
): Promise<T> {
  const locals = response.locals as LibraryLocals;
  if (locals.libraryLeases === undefined || locals.libraryAbort === undefined) {
    throw new Error("Library request context is unavailable");
  }
  if (locals.libraryOperationActive === true) {
    throw new Error("A library operation is already active for this request");
  }
  if (
    request.aborted ||
    locals.libraryAbort.signal.aborted ||
    response.destroyed ||
    response.writableEnded
  ) {
    throw abortError("Library request ended before its operation started");
  }

  locals.libraryOperationActive = true;
  let lease: LibraryLease | undefined;
  try {
    const acquiredLease = await locals.libraryLeases.acquireShared(
      locals.libraryAbort.signal
    );
    lease = acquiredLease;
    if (
      request.aborted ||
      locals.libraryAbort.signal.aborted ||
      response.destroyed ||
      response.writableEnded
    ) {
      throw abortError("Library request ended before its context was acquired");
    }
    const context: LibraryOperationContext = Object.freeze({
      ...acquiredLease.context,
      signal: locals.libraryAbort.signal,
      assertCurrent: () => acquiredLease.assertCurrent()
    });
    setLibraryIdentityHeaders(response, context);
    return await operation(context);
  } finally {
    lease?.release();
    locals.libraryOperationActive = false;
  }
}
