import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiClient,
  ApiClientError,
  setApiBaseUrl
} from "../../src/lib/api-client";

describe("api client reliability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setApiBaseUrl(null);
  });

  it("uses the validated desktop loopback API base without changing API paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    setApiBaseUrl("http://127.0.0.1:43127");
    await expect(apiClient.get("/api/health")).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43127/api/health",
      expect.objectContaining({ method: "GET" })
    );
    expect(() => setApiBaseUrl("https://example.com")).toThrow(
      "API base URL must use the local loopback service"
    );
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
});
