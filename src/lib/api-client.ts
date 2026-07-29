import { normalizeLoopbackApiBaseUrl } from "../desktop/loopback";
import {
  MAX_API_JSON_RESPONSE_BYTES
} from "../../shared/api-limits";
import { observeLibraryResponse } from "./library-identity";
import {
  runLibraryMutation,
  runLibrarySwitch
} from "./library-mutation-coordinator";
export { MAX_API_JSON_RESPONSE_BYTES } from "../../shared/api-limits";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly payload: unknown;

  constructor(
    status: number,
    message: string,
    payload: unknown,
    options: { cause?: unknown; code?: string } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiClientError";
    this.code = options.code ?? "API_REQUEST_FAILED";
    this.status = status;
    this.payload = payload;
  }
}

type JsonBody = Record<string, unknown> | unknown[] | string | number | boolean | null;
export type ApiRequestOptions = {
  signal?: AbortSignal;
};

export type ApiBinaryRequestOptions = ApiRequestOptions & {
  allowedMimeTypes: readonly string[];
  maxBytes: number;
};

export type DesktopApiSession = {
  apiBaseUrl: string;
  protocolSecret: string;
};

export const DEFAULT_API_REQUEST_TIMEOUT_MS = 15_000;

let desktopApiSession: Readonly<DesktopApiSession> | null = null;
const LOCAL_SERVICE_UNREACHABLE_MESSAGE =
  "无法连接本地服务。请确认 Aleksi Learning Workbench 后端已启动，或重新启动学习器。";
const LOCAL_SERVICE_BAD_RESPONSE_MESSAGE =
  "本地服务返回了无法解析的响应。请重启 Aleksi Learning Workbench，或检查后端日志。";
const LOCAL_SERVICE_RESPONSE_TOO_LARGE_MESSAGE =
  "本地服务返回的数据过大。请缩小查询范围后重试；若问题持续，请导出诊断信息。";
const LOCAL_SERVICE_TIMEOUT_MESSAGE =
  "本地服务响应超时。请重试；若仍然超时，请重启 Aleksi Learning Workbench。";
const API_REQUEST_CANCELLED_MESSAGE =
  "请求已取消。可在准备好后重新尝试。";
const LOCAL_SERVICE_BINARY_RESPONSE_TOO_LARGE_MESSAGE =
  "本地服务返回的媒体文件过大，已停止加载。";
const LOCAL_SERVICE_UNSUPPORTED_BINARY_CONTENT_TYPE_MESSAGE =
  "本地服务返回了不受支持的媒体类型，已停止加载。";

function isLocalServiceConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  const message = error.message;
  return (
    code === "ERR_CONNECTION_REFUSED" ||
    message === "Failed to fetch" ||
    message.includes("NetworkError") ||
    message.includes("fetch failed") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ERR_CONNECTION_REFUSED")
  );
}

function localServiceUnreachableError(cause: unknown): ApiClientError {
  return new ApiClientError(0, LOCAL_SERVICE_UNREACHABLE_MESSAGE, null, {
    cause,
    code: "LOCAL_SERVICE_UNREACHABLE"
  });
}

function localServiceTimeoutError(cause: unknown): ApiClientError {
  return new ApiClientError(0, LOCAL_SERVICE_TIMEOUT_MESSAGE, {
    timeoutMs: DEFAULT_API_REQUEST_TIMEOUT_MS,
    recovery: {
      action: "retry_or_restart_local_service"
    }
  }, {
    cause,
    code: "LOCAL_SERVICE_TIMEOUT"
  });
}

function requestCancelledError(cause: unknown): ApiClientError {
  return new ApiClientError(0, API_REQUEST_CANCELLED_MESSAGE, {
    recovery: {
      action: "retry_when_ready"
    }
  }, {
    cause,
    code: "API_REQUEST_CANCELLED"
  });
}

function staleLibraryResponseError(response: Response): ApiClientError {
  return new ApiClientError(
    409,
    "学习库已切换，旧学习库响应已丢弃。",
    {
      responseStatus: response.status,
      recovery: {
        action: "retry_in_active_library"
      }
    },
    { code: "ACTIVE_LIBRARY_CHANGED" }
  );
}

async function rejectStaleLibraryResponse(response: Response): Promise<void> {
  if (observeLibraryResponse(response) !== "stale") {
    return;
  }
  await response.body?.cancel().catch(() => undefined);
  throw staleLibraryResponseError(response);
}

function responseTooLargeError(
  response: Response,
  observedBytes: number,
  measuredBy: "content-length" | "response-body"
): ApiClientError {
  return new ApiClientError(
    response.status,
    LOCAL_SERVICE_RESPONSE_TOO_LARGE_MESSAGE,
    {
      maxBytes: MAX_API_JSON_RESPONSE_BYTES,
      observedBytes,
      measuredBy,
      recovery: {
        action: "narrow_request_or_export_diagnostics"
      }
    },
    { code: "LOCAL_SERVICE_RESPONSE_TOO_LARGE" }
  );
}

function declaredContentLength(response: Response): number | null {
  const rawValue = response.headers.get("Content-Length");
  if (rawValue === null || !/^\d+$/u.test(rawValue.trim())) {
    return null;
  }

  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Request aborted");
}

async function readBoundedResponseText(
  response: Response,
  signal: AbortSignal
): Promise<string> {
  const contentLength = declaredContentLength(response);
  if (
    contentLength !== null &&
    contentLength > MAX_API_JSON_RESPONSE_BYTES
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw responseTooLargeError(response, contentLength, "content-length");
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let observedBytes = 0;
  let text = "";
  const cancelRead = () => {
    void reader.cancel(abortReason(signal)).catch(() => undefined);
  };

  if (signal.aborted) {
    cancelRead();
    throw abortReason(signal);
  }
  signal.addEventListener("abort", cancelRead, { once: true });

  try {
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) {
        throw abortReason(signal);
      }
      if (chunk.done) {
        break;
      }

      observedBytes += chunk.value.byteLength;
      if (observedBytes > MAX_API_JSON_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw responseTooLargeError(
          response,
          observedBytes,
          "response-body"
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener("abort", cancelRead);
    try {
      reader.releaseLock();
    } catch {
      // The stream owns the lock until an in-flight cancellation settles.
    }
  }
}

async function parseResponse(
  response: Response,
  signal: AbortSignal
): Promise<unknown> {
  const text = await readBoundedResponseText(response, signal);

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiClientError(
      response.status,
      LOCAL_SERVICE_BAD_RESPONSE_MESSAGE,
      {
        contentType: response.headers.get("Content-Type") ?? response.headers.get("content-type") ?? "",
        rawText: text.slice(0, 500)
      },
      {
        cause: error,
        code: "LOCAL_SERVICE_BAD_RESPONSE"
      }
    );
  }
}

function apiResponseError(response: Response, payload: unknown): ApiClientError {
  const errorPayload =
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null
      ? payload.error
      : null;
  const message =
    errorPayload !== null &&
    "message" in errorPayload &&
    typeof errorPayload.message === "string"
      ? errorPayload.message
      : `Request failed with status ${response.status}`;
  const code =
    errorPayload !== null &&
    "code" in errorPayload &&
    typeof errorPayload.code === "string"
      ? errorPayload.code
      : "API_REQUEST_FAILED";

  return new ApiClientError(response.status, message, payload, { code });
}

function normalizedContentType(response: Response): string {
  return (response.headers.get("Content-Type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function validateBinaryRequestOptions(
  options: ApiBinaryRequestOptions
): ReadonlySet<string> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new Error("Binary response maxBytes must be a positive safe integer");
  }

  const allowedMimeTypes = new Set(
    options.allowedMimeTypes.map((value) => value.trim().toLowerCase())
  );
  if (allowedMimeTypes.size === 0 || allowedMimeTypes.has("")) {
    throw new Error("Binary responses require at least one valid MIME type");
  }

  return allowedMimeTypes;
}

function binaryResponseTooLargeError(
  response: Response,
  maxBytes: number,
  observedBytes: number,
  measuredBy: "content-length" | "response-body"
): ApiClientError {
  return new ApiClientError(
    response.status,
    LOCAL_SERVICE_BINARY_RESPONSE_TOO_LARGE_MESSAGE,
    {
      maxBytes,
      observedBytes,
      measuredBy,
      recovery: {
        action: "use_a_smaller_supported_media_file"
      }
    },
    { code: "LOCAL_SERVICE_BINARY_RESPONSE_TOO_LARGE" }
  );
}

function unsupportedBinaryContentTypeError(
  response: Response,
  contentType: string,
  allowedMimeTypes: ReadonlySet<string>
): ApiClientError {
  return new ApiClientError(
    response.status,
    LOCAL_SERVICE_UNSUPPORTED_BINARY_CONTENT_TYPE_MESSAGE,
    {
      contentType,
      allowedMimeTypes: [...allowedMimeTypes],
      recovery: {
        action: "use_a_supported_media_file"
      }
    },
    { code: "LOCAL_SERVICE_UNSUPPORTED_BINARY_CONTENT_TYPE" }
  );
}

async function readBoundedResponseBlob(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
  contentType: string
): Promise<Blob> {
  const contentLength = declaredContentLength(response);
  if (contentLength !== null && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw binaryResponseTooLargeError(
      response,
      maxBytes,
      contentLength,
      "content-length"
    );
  }

  if (response.body === null) {
    return new Blob([], { type: contentType });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let observedBytes = 0;
  const cancelRead = () => {
    void reader.cancel(abortReason(signal)).catch(() => undefined);
  };

  if (signal.aborted) {
    cancelRead();
    throw abortReason(signal);
  }
  signal.addEventListener("abort", cancelRead, { once: true });

  try {
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) {
        throw abortReason(signal);
      }
      if (chunk.done) {
        break;
      }

      observedBytes += chunk.value.byteLength;
      if (observedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw binaryResponseTooLargeError(
          response,
          maxBytes,
          observedBytes,
          "response-body"
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener("abort", cancelRead);
    try {
      reader.releaseLock();
    } catch {
      // The stream owns the lock until an in-flight cancellation settles.
    }
  }

  const bytes = new Uint8Array(observedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([bytes.buffer], { type: contentType });
}

export function setDesktopApiSession(value: DesktopApiSession | null): void {
  if (value === null) {
    desktopApiSession = null;
    return;
  }

  const normalized = normalizeLoopbackApiBaseUrl(value.apiBaseUrl);
  if (normalized === null) {
    throw new Error("API base URL must use the local loopback service");
  }
  if (!/^[0-9a-f]{64}$/u.test(value.protocolSecret)) {
    throw new Error(
      "Desktop protocol secret must be 64 lowercase hexadecimal characters"
    );
  }

  desktopApiSession = Object.freeze({
    apiBaseUrl: normalized,
    protocolSecret: value.protocolSecret
  });
}

export function hasDesktopApiSession(): boolean {
  return desktopApiSession !== null;
}

function requestUrl(path: string): string {
  if (!/^\/api(?:\/|$)/u.test(path)) {
    throw new Error("API request path must begin with /api/");
  }
  return desktopApiSession === null
    ? path
    : `${desktopApiSession.apiBaseUrl}${path}`;
}

function requestHeaders(body: JsonBody | undefined): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (desktopApiSession !== null) {
    headers["X-Aleksi-Protocol-Secret"] = desktopApiSession.protocolSecret;
  }
  return Object.keys(headers).length === 0 ? undefined : headers;
}

async function requestJson<T>(
  method: string,
  path: string,
  body?: JsonBody,
  options: ApiRequestOptions = {}
): Promise<T> {
  if (options.signal?.aborted === true) {
    throw requestCancelledError(options.signal.reason);
  }

  const controller = new AbortController();
  let callerCancelled = false;
  let timedOut = false;
  const abortFromCaller = () => {
    if (controller.signal.aborted) {
      return;
    }
    callerCancelled = true;
    controller.abort(options.signal?.reason);
  };
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    if (controller.signal.aborted) {
      return;
    }
    timedOut = true;
    controller.abort();
  }, DEFAULT_API_REQUEST_TIMEOUT_MS);

  let response: Response;
  let payload: unknown;

  try {
    response = await fetch(requestUrl(path), {
      method,
      headers: requestHeaders(body),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    await rejectStaleLibraryResponse(response);
    payload = await parseResponse(response, controller.signal);
  } catch (error) {
    if (timedOut) {
      throw localServiceTimeoutError(error);
    }
    if (callerCancelled) {
      throw requestCancelledError(error);
    }
    if (error instanceof ApiClientError) {
      throw error;
    }
    if (isLocalServiceConnectionError(error)) {
      throw localServiceUnreachableError(error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }

  if (!response.ok) {
    throw apiResponseError(response, payload);
  }

  return payload as T;
}

const LIBRARY_SWITCH_PATHS = new Set([
  "/api/vault/auto-prepare",
  "/api/vault/backups/restore",
  "/api/vault/initialize",
  "/api/vault/migrate",
  "/api/vault/select"
]);

function coordinatedJsonRequest<T>(
  method: "POST" | "PUT",
  path: string,
  body?: JsonBody,
  options?: ApiRequestOptions
): Promise<T> {
  const operation = () => requestJson<T>(method, path, body, options);
  if (LIBRARY_SWITCH_PATHS.has(path)) {
    return runLibrarySwitch(operation);
  }
  if (path.startsWith("/api/runtime/")) {
    return operation();
  }
  return runLibraryMutation(operation);
}

async function requestBinary(
  path: string,
  options: ApiBinaryRequestOptions
): Promise<Blob> {
  const allowedMimeTypes = validateBinaryRequestOptions(options);
  if (options.signal?.aborted === true) {
    throw requestCancelledError(options.signal.reason);
  }

  const controller = new AbortController();
  let callerCancelled = false;
  let timedOut = false;
  const abortFromCaller = () => {
    if (controller.signal.aborted) {
      return;
    }
    callerCancelled = true;
    controller.abort(options.signal?.reason);
  };
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    if (controller.signal.aborted) {
      return;
    }
    timedOut = true;
    controller.abort();
  }, DEFAULT_API_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(requestUrl(path), {
      method: "GET",
      headers: requestHeaders(undefined),
      signal: controller.signal
    });
    await rejectStaleLibraryResponse(response);

    if (!response.ok) {
      const payload = await parseResponse(response, controller.signal);
      throw apiResponseError(response, payload);
    }

    const contentType = normalizedContentType(response);
    if (!allowedMimeTypes.has(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw unsupportedBinaryContentTypeError(
        response,
        contentType,
        allowedMimeTypes
      );
    }

    return await readBoundedResponseBlob(
      response,
      controller.signal,
      options.maxBytes,
      contentType
    );
  } catch (error) {
    if (timedOut) {
      throw localServiceTimeoutError(error);
    }
    if (callerCancelled) {
      throw requestCancelledError(error);
    }
    if (error instanceof ApiClientError) {
      throw error;
    }
    if (isLocalServiceConnectionError(error)) {
      throw localServiceUnreachableError(error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export const apiClient = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    requestJson<T>("GET", path, undefined, options),
  getBinary: (path: string, options: ApiBinaryRequestOptions) =>
    requestBinary(path, options),
  post: <T>(path: string, body?: JsonBody, options?: ApiRequestOptions) =>
    coordinatedJsonRequest<T>("POST", path, body, options),
  put: <T>(path: string, body?: JsonBody, options?: ApiRequestOptions) =>
    coordinatedJsonRequest<T>("PUT", path, body, options)
};
