// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  isDesktop: vi.fn(() => true),
  restartSidecar: vi.fn(async () => undefined),
  snapshot: vi.fn(async () => ({
    mode: "ready" as const,
    apiBaseUrl: "http://127.0.0.1:43127",
    buildId: "bootstrap-test",
    message: null,
    protocolSecret: "a".repeat(64)
  }))
}));

vi.mock("../../src/desktop/runtime", () => ({ desktopRuntime: runtime }));

afterEach(() => {
  vi.resetModules();
  runtime.snapshot.mockClear();
});

describe("desktop API renderer bootstrap", () => {
  it("shares concurrent initialization and re-establishes the session after a fresh module load", async () => {
    const firstRenderer = await import("../../src/app/desktop-api-bootstrap");
    await Promise.all([
      firstRenderer.ensureDesktopApiSession(),
      firstRenderer.ensureDesktopApiSession()
    ]);
    expect(runtime.snapshot).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const freshRenderer = await import("../../src/app/desktop-api-bootstrap");
    await freshRenderer.ensureDesktopApiSession();
    expect(runtime.snapshot).toHaveBeenCalledTimes(2);
  });
});
