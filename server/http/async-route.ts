import type { NextFunction, Request, RequestHandler, Response } from "express";
import { sendHttpError } from "./error-mapper";

export type AsyncRequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction
) => Promise<void>;

export function asyncRoute(handler: AsyncRequestHandler): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch((error: unknown) => {
      if (response.headersSent) {
        next(error);
        return;
      }

      sendHttpError(response, error);
    });
  };
}
