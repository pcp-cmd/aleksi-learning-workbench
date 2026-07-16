import { normalizeLoopbackApiBaseUrl } from "../desktop/loopback";

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
let apiBaseUrl: string | null = null;
const LOCAL_SERVICE_UNREACHABLE_MESSAGE =
  "无法连接本地服务。请确认 Aleksi Learning Workbench 后端已启动，或重新启动学习器。";
const LOCAL_SERVICE_BAD_RESPONSE_MESSAGE =
  "本地服务返回了无法解析的响应。请重启 Aleksi Learning Workbench，或检查后端日志。";

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

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();

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

export function setApiBaseUrl(value: string | null): void {
  if (value === null) {
    apiBaseUrl = null;
    return;
  }

  const normalized = normalizeLoopbackApiBaseUrl(value);
  if (normalized === null) {
    throw new Error("API base URL must use the local loopback service");
  }
  apiBaseUrl = normalized;
}

function requestUrl(path: string): string {
  if (!/^\/api(?:\/|$)/u.test(path)) {
    throw new Error("API request path must begin with /api/");
  }
  return apiBaseUrl === null ? path : `${apiBaseUrl}${path}`;
}

async function requestJson<T>(
  method: string,
  path: string,
  body?: JsonBody
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(requestUrl(path), {
      method,
      headers:
        body === undefined
          ? undefined
          : {
              "Content-Type": "application/json"
            },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    if (isLocalServiceConnectionError(error)) {
      throw localServiceUnreachableError(error);
    }
    throw error;
  }

  const payload = await parseResponse(response);

  if (!response.ok) {
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

    throw new ApiClientError(response.status, message, payload, { code });
  }

  return payload as T;
}

export const apiClient = {
  get: <T>(path: string) => requestJson<T>("GET", path),
  post: <T>(path: string, body?: JsonBody) => requestJson<T>("POST", path, body),
  put: <T>(path: string, body?: JsonBody) => requestJson<T>("PUT", path, body)
};
