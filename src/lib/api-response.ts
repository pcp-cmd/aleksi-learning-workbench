import { MAX_API_JSON_RESPONSE_BYTES } from "../../shared/api-limits";

const LOCAL_SERVICE_BAD_RESPONSE_MESSAGE =
  "本地服务返回了无法解析的响应。请重启 Aleksi Learning Workbench，或检查后端日志。";
const LOCAL_SERVICE_RESPONSE_TOO_LARGE_MESSAGE =
  "本地服务返回的数据过大。请缩小查询范围后重试；若问题持续，请导出诊断信息。";
const LOCAL_SERVICE_BINARY_RESPONSE_TOO_LARGE_MESSAGE =
  "本地服务返回的媒体文件过大，已停止加载。";
const LOCAL_SERVICE_UNSUPPORTED_BINARY_CONTENT_TYPE_MESSAGE =
  "本地服务返回了不受支持的媒体类型，已停止加载。";

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

export async function parseResponse(
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
        contentType:
          response.headers.get("Content-Type") ??
          response.headers.get("content-type") ??
          "",
        rawText: text.slice(0, 500)
      },
      {
        cause: error,
        code: "LOCAL_SERVICE_BAD_RESPONSE"
      }
    );
  }
}

export function apiResponseError(
  response: Response,
  payload: unknown
): ApiClientError {
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

export function normalizedContentType(response: Response): string {
  return (response.headers.get("Content-Type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

export function validateBinaryRequestOptions(options: {
  allowedMimeTypes: readonly string[];
  maxBytes: number;
}): ReadonlySet<string> {
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

export function unsupportedBinaryContentTypeError(
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

export async function readBoundedResponseBlob(
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
