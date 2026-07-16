import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { runtimeBuildIdentity } from "../../server/runtime/build-identity";
import { createRuntimeLifecycle } from "../../server/runtime/lifecycle";

const PREVIEW_ENV = {
  ALEKSI_APP_VERSION: "0.1.0",
  ALEKSI_BUILD_ID: "sha256-0123456789abcdef",
  ALEKSI_RUNTIME_MODE: "friend-preview"
};

describe("runtime build identity and lifecycle", () => {
  it("uses package defaults in development and validated package overrides", () => {
    expect(runtimeBuildIdentity({})).toEqual({
      version: "0.1.0",
      buildId: "dev-0.1.0"
    });
    expect(runtimeBuildIdentity(PREVIEW_ENV)).toEqual({
      version: "0.1.0",
      buildId: "sha256-0123456789abcdef"
    });
    expect(() =>
      runtimeBuildIdentity({
        ALEKSI_APP_VERSION: "0.1.0",
        ALEKSI_BUILD_ID: "unsafe build id"
      })
    ).toThrow("ALEKSI_BUILD_ID");
  });

  it("opens only the resolved active library and exposes packaged capabilities", async () => {
    const openPath = vi.fn(async () => undefined);
    const lifecycle = createRuntimeLifecycle({
      activeLibrary: async () => "C:\\Vaults\\Aleksi",
      env: PREVIEW_ENV,
      openPath,
      platform: "win32"
    });
    const app = createApp({ runtimeLifecycle: lifecycle });

    expect((await request(app).get("/api/runtime/capabilities")).body).toEqual({
      mode: "friend-preview",
      identity: {
        version: "0.1.0",
        buildId: "sha256-0123456789abcdef"
      },
      openLearningLibrary: true,
      exportDiagnostics: true,
      exitWorkbench: true
    });

    const response = await request(app).post("/api/runtime/open-library");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ opened: true });
    expect(openPath).toHaveBeenCalledWith("C:\\Vaults\\Aleksi");
  });

  it("downloads bounded sanitized diagnostic log tails without learning content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-runtime-logs-"));
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "latest.log"),
      `${"x".repeat(20_000)}\nlearning library: C:\\Users\\alice\\Documents\\Secret Vault\n`,
      "utf8"
    );
    await writeFile(
      join(directory, "server.stderr.log"),
      "failed near C:\\Users\\alice\\Documents\\Secret Vault\\private.md\n",
      "utf8"
    );
    const lifecycle = createRuntimeLifecycle({
      env: {
        ...PREVIEW_ENV,
        ALEKSI_RUNTIME_LOG_DIR: directory
      },
      platform: "win32"
    });

    const response = await request(createApp({ runtimeLifecycle: lifecycle }))
      .get("/api/runtime/diagnostics");

    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toContain(
      "aleksi-workbench-diagnostics.json"
    );
    expect(response.body.identity).toEqual(lifecycle.identity);
    expect(response.body.mode).toBe("friend-preview");
    expect(response.body.health.ok).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("alice");
    expect(JSON.stringify(response.body)).not.toContain("private.md");
    expect(JSON.stringify(response.body).length).toBeLessThan(40_000);
  });

  it("responds before requesting packaged runtime shutdown and rejects development exit", async () => {
    const onExitRequested = vi.fn();
    const previewLifecycle = createRuntimeLifecycle({
      env: PREVIEW_ENV,
      onExitRequested,
      platform: "win32"
    });
    const previewResponse = await request(
      createApp({ runtimeLifecycle: previewLifecycle })
    )
      .post("/api/runtime/exit")
      .send({ confirmed: true });

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body).toEqual({ exiting: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(onExitRequested).toHaveBeenCalledTimes(1);

    const developmentResponse = await request(createApp())
      .post("/api/runtime/exit")
      .send({ confirmed: true });
    expect(developmentResponse.status).toBe(409);
    expect(developmentResponse.body.error.code).toBe(
      "RUNTIME_CAPABILITY_UNAVAILABLE"
    );
  });
});
