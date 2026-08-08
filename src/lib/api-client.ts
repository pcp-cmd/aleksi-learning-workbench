import { normalizeLoopbackApiBaseUrl } from "../desktop/loopback";
import {
  getLibraryIdentity,
  observeLibraryResponse,
  type ClientLibraryIdentity
} from "./library-identity";
import {
  runLibraryMutation,
  runLibrarySwitch,
  type LibrarySwitchRecoveryControl
} from "./library-mutation-coordinator";
import {
  ApiClientError,
  apiResponseError,
  parseResponse
} from "./api-response";
import { createBinaryApiClient } from "./api-binary-client";
export { ApiClientError } from "./api-response";
export type {
  ApiBinaryRequestOptions,
  ApiBinaryUploadOptions
} from "./api-binary-client";
export { MAX_API_JSON_RESPONSE_BYTES } from "../../shared/api-limits";

type JsonBody = Record<string, unknown> | unknown[] | string | number | boolean | null;
export type ApiRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type DesktopApiSession = {
  apiBaseUrl: string;
  protocolSecret: string;
};

export const DEFAULT_API_REQUEST_TIMEOUT_MS = 15_000;

let desktopApiSession: Readonly<DesktopApiSession> | null = null;
const LOCAL_SERVICE_UNREACHABLE_MESSAGE =
  "无法连接本地服务。请确认 Aleksi Learning Workbench 后端已启动，或重新启动学习器。";
const LOCAL_SERVICE_TIMEOUT_MESSAGE =
  "本地服务响应超时。请重试；若仍然超时，请重启 Aleksi Learning Workbench。";
const API_REQUEST_CANCELLED_MESSAGE =
  "请求已取消。可在准备好后重新尝试。";

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

function localServiceTimeoutError(
  cause: unknown,
  timeoutMs = DEFAULT_API_REQUEST_TIMEOUT_MS
): ApiClientError {
  return new ApiClientError(0, LOCAL_SERVICE_TIMEOUT_MESSAGE, {
    timeoutMs,
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
  if (desktopApiSession === null) {
    if (
      "__TAURI_INTERNALS__" in globalThis
    ) {
      throw new ApiClientError(
        0,
        "Desktop local service is not ready yet",
        { recovery: { action: "wait_for_desktop_runtime" } },
        { code: "DESKTOP_RUNTIME_NOT_READY" }
      );
    }
    return path;
  }
  return `${desktopApiSession.apiBaseUrl}${path}`;
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

function binaryUploadHeaders(
  contentType?: string
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (contentType !== undefined) headers["Content-Type"] = contentType;
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
  const timeoutMs =
    Number.isSafeInteger(options.timeoutMs) &&
    (options.timeoutMs ?? 0) >= 1_000 &&
    (options.timeoutMs ?? 0) <= 30 * 60_000
      ? options.timeoutMs!
      : DEFAULT_API_REQUEST_TIMEOUT_MS;
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
  }, timeoutMs);

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
      throw localServiceTimeoutError(error, timeoutMs);
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
const CANCELLABLE_LIBRARY_MUTATION_PATHS = new Set<string>();

function libraryOperationLabel(path: string): string {
  if (path.includes("/readings")) return "保存阅读";
  if (path.includes("/cards")) return "保存卡片";
  if (path.includes("/review")) return "保存复习证据";
  if (path.includes("/verification")) return "保存验证证据";
  if (path.includes("/diagnosis")) return "保存学习诊断";
  if (path.includes("/graph")) return "更新主题飞轮";
  if (path.includes("/index")) return "更新学习库索引";
  if (path.includes("/backup")) return "处理学习库备份";
  if (path.includes("/quarantine")) return "处理隔离证据";
  return "保存学习内容";
}

function librarySwitchLabel(path: string): string {
  if (path.endsWith("/initialize")) return "创建本地学习库";
  if (path.endsWith("/migrate")) return "迁移学习库";
  if (path.endsWith("/restore")) return "恢复学习库";
  if (path.endsWith("/select")) return "更换学习库";
  return "准备本地学习库";
}

function isUncertainLibrarySwitchFailure(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    [
      "LOCAL_SERVICE_BAD_RESPONSE",
      "LOCAL_SERVICE_TIMEOUT",
      "LOCAL_SERVICE_UNREACHABLE"
    ].includes(error.code)
  );
}

type ReconciledLibraryStatus = Readonly<{
  status: Readonly<{ path: string }> | null;
}>;

function switchTargetPath(path: string, body: JsonBody | undefined): string | null {
  if (
    path.endsWith("/auto-prepare") ||
    body === undefined ||
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    return null;
  }
  const key =
    path.endsWith("/migrate") || path.endsWith("/restore")
      ? "destinationPath"
      : "path";
  const candidate = body[key];
  return typeof candidate === "string" ? candidate : null;
}

function comparableWindowsPath(path: string): string {
  return path
    .trim()
    .replace(/^"(.*)"$/u, "$1")
    .replace(/\//gu, "\\")
    .replace(/\\+$/u, "")
    .toLocaleLowerCase("en-US");
}

function sameIdentity(
  left: ClientLibraryIdentity | null,
  right: ClientLibraryIdentity | null
): boolean {
  return (
    left?.instanceId === right?.instanceId &&
    left?.vaultId === right?.vaultId &&
    left?.generation === right?.generation
  );
}

function canAdoptReconciledStatus(
  targetPath: string | null,
  status: ReconciledLibraryStatus,
  identityBefore: ClientLibraryIdentity | null
): boolean {
  if (targetPath === null) {
    return status.status !== null;
  }
  if (
    status.status !== null &&
    comparableWindowsPath(status.status.path) ===
      comparableWindowsPath(targetPath)
  ) {
    return true;
  }
  return !sameIdentity(identityBefore, getLibraryIdentity());
}

async function waitForLibrarySwitchSettlement(
  recovery: LibrarySwitchRecoveryControl
): Promise<ReconciledLibraryStatus> {
  for (;;) {
    try {
      return await requestJson<ReconciledLibraryStatus>(
        "GET",
        "/api/vault/status"
      );
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "LIBRARY_BUSY"
      ) {
        continue;
      }
      recovery.enterRecovery();
      await recovery.waitForRetry();
    }
  }
}

function coordinatedJsonRequest<T>(
  method: "POST" | "PUT",
  path: string,
  body?: JsonBody,
  options?: ApiRequestOptions
): Promise<T> {
  if (LIBRARY_SWITCH_PATHS.has(path)) {
    return runLibrarySwitch(
      async (signal, recovery) => {
        const identityBefore = getLibraryIdentity();
        try {
          return await requestJson<T>(method, path, body, {
            ...options,
            signal
          });
        } catch (error) {
          if (isUncertainLibrarySwitchFailure(error)) {
            const reconciled = await waitForLibrarySwitchSettlement(recovery);
            if (
              canAdoptReconciledStatus(
                switchTargetPath(path, body),
                reconciled,
                identityBefore
              )
            ) {
              return reconciled as T;
            }
          }
          throw error;
        }
      },
      {
        label: librarySwitchLabel(path),
        signal: options?.signal
      }
    );
  }
  if (path.startsWith("/api/runtime/")) {
    return requestJson<T>(method, path, body, options);
  }
  return runLibraryMutation(
    (signal) =>
      requestJson<T>(method, path, body, {
        ...options,
        signal
      }),
    {
      label: libraryOperationLabel(path),
      // A write is cancellable only after its server endpoint guarantees
      // pre-commit abort and safe retry. No current production endpoint does.
      cancellable: CANCELLABLE_LIBRARY_MUTATION_PATHS.has(path),
      signal: options?.signal
    }
  );
}

const binaryApiClient = createBinaryApiClient({
  defaultTimeoutMs: DEFAULT_API_REQUEST_TIMEOUT_MS,
  isConnectionError: isLocalServiceConnectionError,
  operationLabel: libraryOperationLabel,
  rejectStaleResponse: rejectStaleLibraryResponse,
  requestHeaders: binaryUploadHeaders,
  requestUrl,
  cancelledError: requestCancelledError,
  timeoutError: localServiceTimeoutError,
  unreachableError: localServiceUnreachableError
});

export const apiClient = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    requestJson<T>("GET", path, undefined, options),
  getBinary: binaryApiClient.getBinary,
  getText: binaryApiClient.getText,
  post: <T>(path: string, body?: JsonBody, options?: ApiRequestOptions) =>
    coordinatedJsonRequest<T>("POST", path, body, options),
  put: <T>(path: string, body?: JsonBody, options?: ApiRequestOptions) =>
    coordinatedJsonRequest<T>("PUT", path, body, options),
  putBinary: binaryApiClient.putBinary
};
