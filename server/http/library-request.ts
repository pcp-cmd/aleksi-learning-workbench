import { randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";
import {
  libraryLeaseManager,
  type LibraryLease,
  type LibraryLeaseManager
} from "../persistence/library-lease";
import type { LibraryContext } from "../persistence/library-context";

type LibraryLocals = {
  libraryAbort?: AbortController;
  libraryLease?: LibraryLease;
  libraryLeasePromise?: Promise<LibraryLease>;
  libraryLeases?: LibraryLeaseManager;
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
    request.once("aborted", abort);
    const locals = response.locals as LibraryLocals;
    locals.libraryAbort = controller;
    locals.libraryLeases = leases;
    response.once("finish", () => request.removeListener("aborted", abort));
    response.once("close", () => request.removeListener("aborted", abort));
    next();
  };
}

export async function requestLibraryContext(
  response: Response
): Promise<LibraryContext> {
  const locals = response.locals as LibraryLocals;
  if (locals.libraryLease !== undefined) {
    return locals.libraryLease.context;
  }
  if (locals.libraryLeases === undefined || locals.libraryAbort === undefined) {
    throw new Error("Library request context is unavailable");
  }
  locals.libraryLeasePromise ??= locals.libraryLeases.acquireShared(
    locals.libraryAbort.signal
  );
  const lease = await locals.libraryLeasePromise;
  if (locals.libraryLease === undefined) {
    if (
      locals.libraryAbort.signal.aborted ||
      response.destroyed ||
      response.writableEnded
    ) {
      lease.release();
      throw new Error("Library request ended before its context was acquired");
    }
    locals.libraryLease = lease;
    setLibraryIdentityHeaders(response, lease.context);
    let released = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      lease.release();
    };
    response.once("finish", release);
    response.once("close", release);
  }
  return lease.context;
}

export function assertRequestLibraryCurrent(response: Response): void {
  const lease = (response.locals as LibraryLocals).libraryLease;
  if (lease === undefined) {
    throw new Error("Library request lease is unavailable");
  }
  lease.assertCurrent();
}
