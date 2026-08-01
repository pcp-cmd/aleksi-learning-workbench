import { runLibraryMutation } from "./library-mutation-coordinator";
import {
  ApiClientError,
  apiResponseError,
  normalizedContentType,
  parseResponse,
  readBoundedResponseBlob,
  unsupportedBinaryContentTypeError,
  validateBinaryRequestOptions
} from "./api-response";

type RequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ApiBinaryRequestOptions = RequestOptions & {
  allowedMimeTypes: readonly string[];
  maxBytes: number;
};

export type ApiBinaryUploadOptions = RequestOptions & {
  contentType?: string;
};

type BinaryClientDependencies = {
  defaultTimeoutMs: number;
  isConnectionError(error: unknown): boolean;
  operationLabel(path: string): string;
  rejectStaleResponse(response: Response): Promise<void>;
  requestHeaders(contentType?: string): Record<string, string> | undefined;
  requestUrl(path: string): string;
  cancelledError(cause: unknown): ApiClientError;
  timeoutError(cause: unknown, timeoutMs: number): ApiClientError;
  unreachableError(cause: unknown): ApiClientError;
};

function timeoutMs(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 1_000 && (value ?? 0) <= 30 * 60_000
    ? value!
    : fallback;
}

async function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read text response"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(blob, "utf-8");
  });
}

export function createBinaryApiClient(dependencies: BinaryClientDependencies) {
  async function requestDownload(
    path: string,
    options: ApiBinaryRequestOptions
  ): Promise<Blob> {
    const allowedMimeTypes = validateBinaryRequestOptions(options);
    if (options.signal?.aborted === true) {
      throw dependencies.cancelledError(options.signal.reason);
    }
    const controller = new AbortController();
    let callerCancelled = false;
    let timedOut = false;
    const abortFromCaller = () => {
      if (controller.signal.aborted) return;
      callerCancelled = true;
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const requestTimeoutMs = timeoutMs(options.timeoutMs, dependencies.defaultTimeoutMs);
    const timeout = setTimeout(() => {
      if (controller.signal.aborted) return;
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    try {
      const response = await fetch(dependencies.requestUrl(path), {
        method: "GET",
        headers: dependencies.requestHeaders(),
        signal: controller.signal
      });
      await dependencies.rejectStaleResponse(response);
      if (!response.ok) {
        throw apiResponseError(response, await parseResponse(response, controller.signal));
      }
      const contentType = normalizedContentType(response);
      if (!allowedMimeTypes.has(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw unsupportedBinaryContentTypeError(response, contentType, allowedMimeTypes);
      }
      return await readBoundedResponseBlob(
        response,
        controller.signal,
        options.maxBytes,
        contentType
      );
    } catch (error) {
      if (timedOut) throw dependencies.timeoutError(error, requestTimeoutMs);
      if (callerCancelled) throw dependencies.cancelledError(error);
      if (error instanceof ApiClientError) throw error;
      if (dependencies.isConnectionError(error)) throw dependencies.unreachableError(error);
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async function requestUpload<T>(
    path: string,
    body: Blob,
    options: ApiBinaryUploadOptions = {}
  ): Promise<T> {
    if (options.signal?.aborted === true) {
      throw dependencies.cancelledError(options.signal.reason);
    }
    const controller = new AbortController();
    let callerCancelled = false;
    let timedOut = false;
    const abortFromCaller = () => {
      callerCancelled = true;
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const requestTimeoutMs = timeoutMs(options.timeoutMs, dependencies.defaultTimeoutMs);
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    try {
      const response = await fetch(dependencies.requestUrl(path), {
        method: "PUT",
        headers: dependencies.requestHeaders(options.contentType ?? "application/octet-stream"),
        body,
        signal: controller.signal
      });
      await dependencies.rejectStaleResponse(response);
      const payload = await parseResponse(response, controller.signal);
      if (!response.ok) throw apiResponseError(response, payload);
      return payload as T;
    } catch (error) {
      if (timedOut) throw dependencies.timeoutError(error, requestTimeoutMs);
      if (callerCancelled) throw dependencies.cancelledError(error);
      if (error instanceof ApiClientError) throw error;
      if (dependencies.isConnectionError(error)) throw dependencies.unreachableError(error);
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  return {
    getBinary: requestDownload,
    getText: async (path: string, options: ApiBinaryRequestOptions) =>
      blobText(await requestDownload(path, options)),
    putBinary: <T>(path: string, body: Blob, options?: ApiBinaryUploadOptions) =>
      runLibraryMutation(
        (signal) => requestUpload<T>(path, body, { ...options, signal }),
        {
          label: dependencies.operationLabel(path),
          cancellable: false,
          signal: options?.signal
        }
      )
  };
}
