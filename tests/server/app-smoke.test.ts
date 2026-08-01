import request from "supertest";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../server/app";
import { READING_JSON_BODY_LIMIT_BYTES } from "../../shared/api-limits";

const packageVersion = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
).version as string;
const desktopProtocolSecret = "a".repeat(64);

describe("local server", () => {
  it("reports health without exposing a public bind", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      service: "aleksi-workbench",
      version: packageVersion,
      buildId: expect.stringMatching(/^[a-z0-9.-]+$/u)
    });
  });

  it("serves built frontend assets and history routes in runtime mode", async () => {
    const distDirectory = await mkdtemp(join(tmpdir(), "aleksi-dist-"));
    await writeFile(
      join(distDirectory, "index.html"),
      "<!doctype html><html><body><div id=\"root\">runtime app</div></body></html>",
      "utf8"
    );

    const app = createApp({ staticDistDir: distDirectory });

    const rootResponse = await request(app).get("/");
    const routeResponse = await request(app).get("/today");

    expect(rootResponse.status).toBe(200);
    expect(rootResponse.text).toContain("runtime app");
    expect(routeResponse.status).toBe(200);
    expect(routeResponse.text).toContain("runtime app");
  });

  it("allows only the Tauri window origin for desktop sidecar requests", async () => {
    const app = createApp({ desktopProtocolSecret });
    const allowed = await request(app)
      .get("/api/health")
      .set("Origin", "http://tauri.localhost")
      .set("X-Aleksi-Protocol-Secret", desktopProtocolSecret);
    const legacyProtocol = await request(app)
      .get("/api/health")
      .set("Origin", "tauri://localhost")
      .set("X-Aleksi-Protocol-Secret", desktopProtocolSecret);
    const blocked = await request(app)
      .get("/api/health")
      .set("Origin", "https://example.com");

    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://tauri.localhost"
    );
    expect(allowed.headers.vary).toContain("Origin");
    expect(legacyProtocol.status).toBe(200);
    expect(legacyProtocol.headers["access-control-allow-origin"]).toBe(
      "tauri://localhost"
    );
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("DESKTOP_ORIGIN_FORBIDDEN");
  });

  it("answers desktop JSON preflight without enabling CORS in browser mode", async () => {
    const preflight = await request(createApp({ desktopProtocolSecret }))
      .options("/api/vault/initialize")
      .set("Origin", "http://tauri.localhost")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");
    const browserMode = await request(createApp())
      .get("/api/health")
      .set("Origin", "http://tauri.localhost");

    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain("POST");
    expect(preflight.headers["access-control-allow-headers"]).toContain(
      "X-Aleksi-Protocol-Secret"
    );
    expect(browserMode.status).toBe(200);
    expect(browserMode.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns a JSON recovery message for oversized pasted reading payloads", async () => {
    const response = await request(createApp())
      .post("/api/readings")
      .send({
        title: "过长材料",
        concept: "长文本",
        source: "manual-paste",
        body: "x".repeat(11 * 1024 * 1024)
      });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "阅读材料太长，请缩短到 2 MiB 以内后再保存。",
        recovery: {
          action: "reduce_payload",
          target: "reading_material",
          maxBytes: READING_JSON_BODY_LIMIT_BYTES
        }
      }
    });
  });

  it("returns a structured JSON 404 for unknown API routes before SPA fallback", async () => {
    const distDirectory = await mkdtemp(join(tmpdir(), "aleksi-dist-"));
    await writeFile(
      join(distDirectory, "index.html"),
      "<!doctype html><html><body>runtime app</body></html>",
      "utf8"
    );

    const response = await request(createApp({ staticDistDir: distDirectory }))
      .get("/api/not-a-route");

    expect(response.status).toBe(404);
    expect(response.type).toMatch(/json/u);
    expect(response.body).toEqual({
      error: {
        code: "API_ROUTE_NOT_FOUND",
        message: "未找到本地服务接口"
      }
    });
    expect(response.text).not.toContain("runtime app");
  });
});
