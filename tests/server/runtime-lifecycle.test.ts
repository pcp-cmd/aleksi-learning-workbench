import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { runtimeBuildIdentity } from "../../server/runtime/build-identity";
import { createRuntimeLifecycle } from "../../server/runtime/lifecycle";

const packageVersion = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
).version as string;

const PREVIEW_ENV = {
  ALEKSI_APP_VERSION: "0.1.0",
  ALEKSI_BUILD_ID: "sha256-0123456789abcdef",
  ALEKSI_RUNTIME_MODE: "friend-preview"
};

describe("runtime build identity and lifecycle", () => {
  it("uses package defaults in development and validated package overrides", () => {
    expect(runtimeBuildIdentity({})).toEqual({
      version: packageVersion,
      buildId: `dev-${packageVersion}`
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

  it("downloads only bounded allowlisted diagnostic tails with secrets and locations redacted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-runtime-logs-"));
    const protocolSecret = "protocol-secret-value-7d20";
    const serviceToken = "service-token-value-48f1";
    const apiKey = "inline-api-key-value-91c2";
    const password = "inline-password-value-63b4";
    const cookie = "inline-cookie-value-20a7";
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "latest.log"),
      [
        "x".repeat(20_000),
        `ECONNREFUSED fetching https://alice:${protocolSecret}@api.example.test/private?token=${serviceToken}&mode=debug`,
        `Authorization: Bearer ${protocolSecret}`,
        `x-api-key=${apiKey}`,
        `password=\"${password}\"`,
        `Cookie: session=${cookie}; theme=dark`,
        'learning library: "C:\\Users\\alice\\Documents\\Secret Vault\\private.md"',
        'network library: "\\\\fileserver\\learners\\alice\\private.md"',
        "local URL: file:///C:/Users/alice/Documents/private.md",
        'POSIX library: "/home/alice/private.md"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "server.stderr.log"),
      'ENOENT: failed to open "/home/alice/private.md"; category=filesystem\n',
      "utf8"
    );
    await writeFile(
      join(directory, "not-allowlisted.log"),
      `must never be exported ${protocolSecret}\n`,
      "utf8"
    );
    const lifecycle = createRuntimeLifecycle({
      env: {
        ...PREVIEW_ENV,
        ALEKSI_RUNTIME_LOG_DIR: directory,
        ALEKSI_PROTOCOL_SECRET: protocolSecret,
        SERVICE_AUTH_TOKEN: serviceToken,
        INNOCENT_SETTING: "must-not-be-dumped"
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
    expect(Object.keys(response.body)).toEqual([
      "generatedAt",
      "identity",
      "mode",
      "health",
      "logs"
    ]);
    expect(response.body.logs.map((entry: { name: string }) => entry.name)).toEqual([
      "latest.log",
      "server.stderr.log"
    ]);
    for (const entry of response.body.logs as Array<{
      name: string;
      tail: string;
    }>) {
      expect(Buffer.byteLength(entry.tail, "utf8")).toBeLessThanOrEqual(8 * 1024);
    }

    const serialized = JSON.stringify(response.body);
    for (const sensitiveValue of [
      protocolSecret,
      serviceToken,
      apiKey,
      password,
      cookie,
      "must-not-be-dumped",
      "alice",
      "private.md",
      "fileserver",
      "https://",
      "file:///",
      "/home/"
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
    expect(serialized).toContain("ECONNREFUSED");
    expect(serialized).toContain("ENOENT");
    expect(serialized).toContain("filesystem");
    expect(serialized).toContain("[redacted]");
    expect(serialized.length).toBeLessThan(40_000);
  });

  it("D11 surfaces a destroyed-window shutdown failure as redacted diagnostic health", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aleksi-lifecycle-health-"));
    const protocolSecret = "d".repeat(64);
    await writeFile(
      join(directory, "desktop-lifecycle.log"),
      [
        "destroyed-window shutdown failed",
        `protocolSecret=${protocolSecret}`,
        'sidecar path "C:\\Users\\alice\\Private Vault\\server.cjs"'
      ].join("\n"),
      "utf8"
    );
    const lifecycle = createRuntimeLifecycle({
      env: {
        ...PREVIEW_ENV,
        ALEKSI_RUNTIME_LOG_DIR: directory,
        ALEKSI_PROTOCOL_SECRET: protocolSecret
      },
      platform: "win32"
    });

    const report = await lifecycle.createDiagnosticReport();

    expect(report.health).toEqual({
      ok: false,
      service: "aleksi-workbench",
      desktopLifecycle: "failed"
    });
    expect(report.logs.map((entry) => entry.name)).toContain(
      "desktop-lifecycle.log"
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(protocolSecret);
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain("server.cjs");
    expect(serialized).toContain("[redacted]");
    expect(serialized).toContain("[local path]");
  });

  it("D06-D10 retain the native lifecycle safety contracts", () => {
    const runtime = readFileSync(
      new URL("../../src-tauri/src/runtime.rs", import.meta.url),
      "utf8"
    );
    const commands = readFileSync(
      new URL("../../src-tauri/src/commands.rs", import.meta.url),
      "utf8"
    );
    const shell = readFileSync(
      new URL("../../src-tauri/src/lib.rs", import.meta.url),
      "utf8"
    );

    const shutdownFailureBranch = runtime.slice(
      runtime.indexOf("pub fn shutdown(&self)"),
      runtime.indexOf("pub fn restart(&self")
    );
    expect(shutdownFailureBranch).toContain("RuntimeSnapshot::stop_failed");
    expect(shutdownFailureBranch).not.toMatch(
      /Err\(error\)[\s\S]{0,500}inner\.child\s*=\s*None/u
    );
    expect(runtime).toContain(
      "Cannot start a new sidecar while the previous process has not stopped"
    );
    expect(runtime).toContain("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE");
    expect(runtime).toContain("if inner.generation != generation");
    expect(commands).toContain("std::process::exit(1)");
    expect(shell).toContain("record_destroyed_window_shutdown_failure");
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
