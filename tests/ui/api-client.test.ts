import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiClient,
  ApiClientError,
  setDesktopApiSession
} from "../../src/lib/api-client";

const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_READING_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const READING_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

describe("api client reliability", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setDesktopApiSession(null);
  });

  it("atomically installs the desktop loopback base and protocol secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    setDesktopApiSession({
      apiBaseUrl: "http://127.0.0.1:43127",
      protocolSecret: "a".repeat(64)
    });
    await expect(apiClient.get("/api/health")).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43127/api/health",
      expect.objectContaining({
        method: "GET",
        headers: {
          "X-Aleksi-Protocol-Secret": "a".repeat(64)
        }
      })
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("a".repeat(64));
  });

  it("rejects invalid desktop sessions without partially replacing the active session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    setDesktopApiSession({
      apiBaseUrl: "http://127.0.0.1:43127",
      protocolSecret: "b".repeat(64)
    });
    expect(() =>
      setDesktopApiSession({
        apiBaseUrl: "https://example.com",
        protocolSecret: "c".repeat(64)
      })
    ).toThrow(
      "API base URL must use the local loopback service"
    );
    expect(() =>
      setDesktopApiSession({
        apiBaseUrl: "http://localhost:43127",
        protocolSecret: "c".repeat(64)
      })
    ).toThrow("API base URL must use the local loopback service");
    expect(() =>
      setDesktopApiSession({
        apiBaseUrl: "http://127.0.0.1:5000",
        protocolSecret: "A".repeat(64)
      })
    ).toThrow(
      "Desktop protocol secret must be 64 lowercase hexadecimal characters"
    );

    await apiClient.post("/api/cards", { front: "question" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43127/api/cards",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "X-Aleksi-Protocol-Secret": "b".repeat(64)
        }
      })
    );
  });

  it("keeps browser development requests relative and secret-free", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    setDesktopApiSession({
      apiBaseUrl: "http://127.0.0.1:43127",
      protocolSecret: "d".repeat(64)
    });
    setDesktopApiSession(null);
    await apiClient.get("/api/health");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ method: "GET", headers: undefined })
    );
  });

  it("fetches reading media through the authenticated desktop session", async () => {
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(imageBytes, {
        status: 200,
        headers: {
          "Content-Length": String(imageBytes.byteLength),
          "Content-Type": "image/png"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    setDesktopApiSession({
      apiBaseUrl: "http://127.0.0.1:43127",
      protocolSecret: "f".repeat(64)
    });

    const blob = await apiClient.getBinary(
      "/api/readings/11111111-1111-4111-8111-111111111111/media?path=assets%2Fdiagram.png",
      {
        allowedMimeTypes: READING_IMAGE_MIME_TYPES,
        maxBytes: MAX_READING_IMAGE_BYTES
      }
    );

    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(imageBytes);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43127/api/readings/11111111-1111-4111-8111-111111111111/media?path=assets%2Fdiagram.png",
      expect.objectContaining({
        method: "GET",
        headers: {
          "X-Aleksi-Protocol-Secret": "f".repeat(64)
        },
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("keeps browser reading-media requests relative and secret-free", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0x47, 0x49, 0x46]), {
        status: 200,
        headers: { "Content-Type": "image/gif" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.getBinary(
      "/api/readings/11111111-1111-4111-8111-111111111111/media?path=assets%2Fdiagram.gif",
      {
        allowedMimeTypes: READING_IMAGE_MIME_TYPES,
        maxBytes: MAX_READING_IMAGE_BYTES
      }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/readings/11111111-1111-4111-8111-111111111111/media?path=assets%2Fdiagram.gif",
      expect.objectContaining({ method: "GET", headers: undefined })
    );
  });

  it("rejects unsupported reading-media MIME types before consuming the body", async () => {
    let bodyPulled = false;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          bodyPulled = true;
          controller.enqueue(new TextEncoder().encode("<svg></svg>"));
          controller.close();
        },
        cancel() {
          cancelled = true;
        }
      },
      { highWaterMark: 0 }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "image/svg+xml" }
        })
      )
    );

    const error = await apiClient
      .getBinary("/api/readings/example/media?path=diagram.svg", {
        allowedMimeTypes: READING_IMAGE_MIME_TYPES,
        maxBytes: MAX_READING_IMAGE_BYTES
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "LOCAL_SERVICE_UNSUPPORTED_BINARY_CONTENT_TYPE",
      status: 200,
      payload: {
        allowedMimeTypes: READING_IMAGE_MIME_TYPES,
        contentType: "image/svg+xml"
      }
    });
    expect(bodyPulled).toBe(false);
    expect(cancelled).toBe(true);
  });

  it("rejects oversized declared reading media before consuming the body", async () => {
    let bodyPulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          bodyPulled = true;
          controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
          controller.close();
        }
      },
      { highWaterMark: 0 }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: {
            "Content-Length": String(MAX_READING_IMAGE_BYTES + 1),
            "Content-Type": "image/png"
          }
        })
      )
    );

    const error = await apiClient
      .getBinary("/api/readings/example/media?path=oversized.png", {
        allowedMimeTypes: READING_IMAGE_MIME_TYPES,
        maxBytes: MAX_READING_IMAGE_BYTES
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "LOCAL_SERVICE_BINARY_RESPONSE_TOO_LARGE",
      payload: {
        maxBytes: MAX_READING_IMAGE_BYTES,
        observedBytes: MAX_READING_IMAGE_BYTES + 1,
        measuredBy: "content-length"
      }
    });
    expect(bodyPulled).toBe(false);
  });

  it("bounds streamed reading-media responses and cancels the body on overflow", async () => {
    const chunkSize = 6 * 1024 * 1024;
    let chunksSent = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          chunksSent += 1;
          if (chunksSent <= 2) {
            controller.enqueue(new Uint8Array(chunkSize));
          } else {
            controller.close();
          }
        },
        cancel() {
          cancelled = true;
        }
      },
      { highWaterMark: 0 }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "image/png" }
        })
      )
    );

    const error = await apiClient
      .getBinary("/api/readings/example/media?path=oversized.png", {
        allowedMimeTypes: READING_IMAGE_MIME_TYPES,
        maxBytes: MAX_READING_IMAGE_BYTES
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "LOCAL_SERVICE_BINARY_RESPONSE_TOO_LARGE",
      status: 200,
      payload: {
        maxBytes: MAX_READING_IMAGE_BYTES,
        observedBytes: 12 * 1024 * 1024,
        measuredBy: "response-body"
      }
    });
    expect(cancelled).toBe(true);
  });

  it("cancels an in-flight reading-media request with the caller signal", async () => {
    const caller = new AbortController();
    let fetchSignal: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        fetchSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
        });
      })
    );

    const outcome = apiClient
      .getBinary("/api/readings/example/media?path=diagram.png", {
        allowedMimeTypes: READING_IMAGE_MIME_TYPES,
        maxBytes: MAX_READING_IMAGE_BYTES,
        signal: caller.signal
      })
      .catch((caught: unknown) => caught);
    caller.abort(new DOMException("Reader changed", "AbortError"));
    const error = await outcome;

    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(error).toMatchObject({
      code: "API_REQUEST_CANCELLED",
      status: 0
    });
  });

  it.each([
    new TypeError("Failed to fetch"),
    new Error("NetworkError when attempting to fetch resource."),
    new TypeError("fetch failed"),
    Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5174"), {
      code: "ERR_CONNECTION_REFUSED"
    })
  ])("translates local service connection failures into user language", async (cause) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));

    await expect(apiClient.get("/api/vault/status")).rejects.toMatchObject({
      code: "LOCAL_SERVICE_UNREACHABLE",
      message: "无法连接本地服务。请确认 Aleksi Learning Workbench 后端已启动，或重新启动学习器。",
      status: 0,
      cause
    });
  });

  it("preserves server-provided API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "INVALID_ABSOLUTE_PATH",
              message: "学习库位置必须是完整路径，例如：\nC:\\Users\\pcp\\Documents\\Aleksi Learning Workbench"
            }
          }),
          { status: 400 }
        )
      )
    );

    const error = await apiClient
      .post("/api/vault/select", { path: "vault" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "INVALID_ABSOLUTE_PATH",
      status: 400
    });
  });

  it("wraps invalid or non-JSON local-service responses in a friendly API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body>Proxy failed</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html" }
        })
      )
    );

    const error = await apiClient
      .get("/api/vault/status")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "LOCAL_SERVICE_BAD_RESPONSE",
      message: "本地服务返回了无法解析的响应。请重启 Aleksi Learning Workbench，或检查后端日志。",
      status: 502,
      payload: {
        contentType: "text/html",
        rawText: "<html><body>Proxy failed</body></html>"
      }
    });
  });

  it("rejects an oversized declared Content-Length before reading the response body", async () => {
    const protocolSecret = "e".repeat(64);
    let bodyPulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          bodyPulled = true;
          controller.enqueue(new TextEncoder().encode('{"ok":true}'));
          controller.close();
        }
      },
      { highWaterMark: 0 }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: {
            "Content-Length": String(MAX_JSON_RESPONSE_BYTES + 1),
            "Content-Type": "application/json"
          }
        })
      )
    );
    setDesktopApiSession({
      apiBaseUrl: "http://127.0.0.1:43127",
      protocolSecret
    });

    const error = await apiClient
      .get("/api/graph")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "LOCAL_SERVICE_RESPONSE_TOO_LARGE",
      status: 200,
      payload: {
        maxBytes: MAX_JSON_RESPONSE_BYTES,
        observedBytes: MAX_JSON_RESPONSE_BYTES + 1,
        measuredBy: "content-length",
        recovery: {
          action: "narrow_request_or_export_diagnostics"
        }
      }
    });
    expect(bodyPulled).toBe(false);
    expect(JSON.stringify(error)).not.toContain(protocolSecret);
  });

  it("accepts a valid JSON response exactly at the 2 MiB boundary", async () => {
    const exactBoundaryJson = JSON.stringify(
      "x".repeat(MAX_JSON_RESPONSE_BYTES - 2)
    );
    expect(new TextEncoder().encode(exactBoundaryJson)).toHaveLength(
      MAX_JSON_RESPONSE_BYTES
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(exactBoundaryJson, {
          status: 200,
          headers: {
            "Content-Length": String(MAX_JSON_RESPONSE_BYTES),
            "Content-Type": "application/json"
          }
        })
      )
    );

    const payload = await apiClient.get<string>("/api/graph");

    expect(payload).toHaveLength(MAX_JSON_RESPONSE_BYTES - 2);
  });

  it("stops streaming a JSON response once the actual body exceeds 2 MiB", async () => {
    const oversizedJson = new TextEncoder().encode(
      JSON.stringify({ body: "x".repeat(MAX_JSON_RESPONSE_BYTES) })
    );
    const chunkSize = 512 * 1024;
    let offset = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (offset >= oversizedJson.byteLength) {
            controller.close();
            return;
          }
          const nextOffset = Math.min(
            offset + chunkSize,
            oversizedJson.byteLength
          );
          controller.enqueue(oversizedJson.slice(offset, nextOffset));
          offset = nextOffset;
        },
        cancel() {
          cancelled = true;
        }
      },
      { highWaterMark: 0 }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const error = await apiClient
      .get("/api/readings")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "LOCAL_SERVICE_RESPONSE_TOO_LARGE",
      status: 200,
      payload: {
        maxBytes: MAX_JSON_RESPONSE_BYTES,
        observedBytes: expect.any(Number),
        measuredBy: "response-body"
      }
    });
    expect((error as ApiClientError).payload).toMatchObject({
      observedBytes: expect.any(Number)
    });
    expect(
      ((error as ApiClientError).payload as { observedBytes: number })
        .observedBytes
    ).toBeGreaterThan(MAX_JSON_RESPONSE_BYTES);
    expect(cancelled).toBe(true);
  });

  it("aborts a request after 15 seconds and returns timeout recovery guidance", async () => {
    vi.useFakeTimers();
    let fetchSignal: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal === undefined || init.signal === null) {
          return Promise.reject(new Error("Expected an internal AbortSignal"));
        }
        fetchSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
        });
      })
    );

    const outcome = apiClient
      .get("/api/today")
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    const error = await outcome;

    expect(error).toMatchObject({
      code: "LOCAL_SERVICE_TIMEOUT",
      status: 0,
      payload: {
        timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
        recovery: {
          action: "retry_or_restart_local_service"
        }
      }
    });
    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("accepts a caller AbortSignal and distinguishes active cancellation from timeout", async () => {
    const caller = new AbortController();
    let fetchSignal: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal === undefined || init.signal === null) {
          return Promise.reject(new Error("Expected a composed AbortSignal"));
        }
        fetchSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
        });
      })
    );

    const outcome = apiClient
      .get("/api/review", { signal: caller.signal })
      .catch((caught: unknown) => caught);
    caller.abort(new DOMException("User cancelled", "AbortError"));
    const error = await outcome;

    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "API_REQUEST_CANCELLED",
      status: 0,
      payload: {
        recovery: {
          action: "retry_when_ready"
        }
      }
    });
    expect((error as ApiClientError).code).not.toBe("LOCAL_SERVICE_TIMEOUT");
  });
});
