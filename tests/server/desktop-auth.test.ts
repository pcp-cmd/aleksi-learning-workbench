import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";

const SECRET = "a".repeat(64);
const HEADER = "X-Aleksi-Protocol-Secret";
const ORIGIN = "http://tauri.localhost";

describe("desktop local protocol authentication", () => {
  it("requires both an approved desktop origin and the per-launch secret", async () => {
    const app = createApp({ desktopProtocolSecret: SECRET });

    const missingOrigin = await request(app)
      .get("/api/health")
      .set(HEADER, SECRET);
    const missingSecret = await request(app)
      .get("/api/health")
      .set("Origin", ORIGIN);
    const wrongSecret = await request(app)
      .get("/api/health")
      .set("Origin", ORIGIN)
      .set(HEADER, "b".repeat(64));
    const authenticated = await request(app)
      .get("/api/health")
      .set("Origin", ORIGIN)
      .set(HEADER, SECRET);

    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.error.code).toBe("DESKTOP_ORIGIN_REQUIRED");
    expect(missingSecret.status).toBe(401);
    expect(missingSecret.body.error.code).toBe("DESKTOP_AUTH_REQUIRED");
    expect(wrongSecret.status).toBe(401);
    expect(wrongSecret.body.error.code).toBe("DESKTOP_AUTH_INVALID");
    expect(authenticated.status).toBe(200);
  });

  it("does not accept the protocol secret from a URL query parameter", async () => {
    const response = await request(
      createApp({ desktopProtocolSecret: SECRET })
    )
      .get(`/api/health?protocolSecret=${SECRET}`)
      .set("Origin", ORIGIN);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("DESKTOP_AUTH_REQUIRED");
  });

  it("permits only an origin-checked, data-free OPTIONS preflight", async () => {
    const app = createApp({ desktopProtocolSecret: SECRET });
    const allowed = await request(app)
      .options("/api/readings")
      .set("Origin", ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set(
        "Access-Control-Request-Headers",
        "content-type, x-aleksi-protocol-secret"
      );
    const blocked = await request(app)
      .options("/api/readings")
      .set("Origin", "https://example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(allowed.status).toBe(204);
    expect(allowed.text).toBe("");
    expect(allowed.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(allowed.headers["access-control-allow-headers"]).toContain(HEADER);
    expect(blocked.status).toBe(403);
  });

  it("rejects malformed configured secrets before opening the API", () => {
    expect(() => createApp({ desktopProtocolSecret: "not-a-secret" })).toThrow(
      /protocol secret/u
    );
  });

  it("keeps browser development mode available without desktop credentials", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
  });
});
