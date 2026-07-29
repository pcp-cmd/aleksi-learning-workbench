import { describe, expect, it, vi } from "vitest";
import {
  createDesktopRuntime,
  type DesktopRuntimeSnapshot
} from "../../src/desktop/runtime";

const readySnapshot: DesktopRuntimeSnapshot = {
  mode: "ready",
  apiBaseUrl: "http://127.0.0.1:43127",
  buildId: "desktop-test-build",
  message: null,
  protocolSecret: "a".repeat(64)
};

describe("desktop runtime command boundary", () => {
  it("returns a browser-development snapshot without invoking Tauri", async () => {
    const invoke = vi.fn();
    const runtime = createDesktopRuntime({
      invoke,
      isDesktop: () => false
    });

    await expect(runtime.snapshot()).resolves.toEqual({
      mode: "browser-development",
      apiBaseUrl: null,
      buildId: null,
      message: null,
      protocolSecret: null
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses only the named desktop commands and validates their responses", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "desktop_runtime_snapshot") {
        return readySnapshot;
      }
      if (command === "select_reading_file") {
        return {
          body: "# 极限",
          fileName: "极限.md",
          size: 12
        };
      }
      if (command === "select_learning_library") {
        return "C:\\Users\\学习者\\Documents\\Aleksi";
      }
      if (command === "export_diagnostics") {
        return "C:\\Users\\学习者\\Downloads\\aleksi-workbench-diagnostics.json";
      }
      return null;
    });
    const runtime = createDesktopRuntime({ invoke, isDesktop: () => true });

    await expect(runtime.snapshot()).resolves.toEqual(readySnapshot);
    await expect(runtime.selectReadingFile()).resolves.toEqual({
      body: "# 极限",
      fileName: "极限.md",
      size: 12
    });
    await expect(runtime.selectLearningLibrary()).resolves.toBe(
      "C:\\Users\\学习者\\Documents\\Aleksi"
    );
    await runtime.restartSidecar();
    await runtime.openLearningLibrary();
    await expect(runtime.exportDiagnostics()).resolves.toContain("diagnostics.json");
    await runtime.requestExit();

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "desktop_runtime_snapshot",
      "select_reading_file",
      "select_learning_library",
      "restart_sidecar",
      "open_learning_library",
      "export_diagnostics",
      "request_exit"
    ]);
  });

  it("rejects malformed runtime state instead of trusting the native boundary", async () => {
    const runtime = createDesktopRuntime({
      invoke: vi.fn(async () => ({
        mode: "ready",
        apiBaseUrl: "https://example.com",
        buildId: "wrong-origin",
        message: null,
        protocolSecret: "b".repeat(64)
      })),
      isDesktop: () => true
    });

    await expect(runtime.snapshot()).rejects.toThrow(
      "桌面运行时返回了无效的 API 地址"
    );
  });

  it("requires a non-empty protocol secret for a ready desktop runtime", async () => {
    const runtime = createDesktopRuntime({
      invoke: vi.fn(async () => ({
        mode: "ready",
        apiBaseUrl: "http://127.0.0.1:43127",
        buildId: "desktop-test-build",
        message: null,
        protocolSecret: null
      })),
      isDesktop: () => true
    });

    await expect(runtime.snapshot()).rejects.toThrow(
      "ready desktop runtime did not provide a protocol secret"
    );
  });

  it("accepts an omitted secret while the sidecar is still starting", async () => {
    const runtime = createDesktopRuntime({
      invoke: vi.fn(async () => ({
        mode: "starting",
        apiBaseUrl: null,
        buildId: "desktop-test-build",
        message: null
      })),
      isDesktop: () => true
    });

    await expect(runtime.snapshot()).resolves.toMatchObject({
      mode: "starting",
      protocolSecret: null
    });
  });

  it("D08 rejects if the non-returning native force-exit command returns", async () => {
    const invoke = vi.fn(async () => undefined);
    const runtime = createDesktopRuntime({
      invoke,
      isDesktop: () => true
    });

    await expect(runtime.forceExit()).rejects.toThrow(
      "Force-exit command returned while the application is still running"
    );
    expect(invoke).toHaveBeenCalledWith("force_exit");
  });

  it("rejects a ready protocol secret outside the 64-character lowercase hex contract", async () => {
    const runtime = createDesktopRuntime({
      invoke: vi.fn(async () => ({
        mode: "ready",
        apiBaseUrl: "http://127.0.0.1:43127",
        buildId: "desktop-test-build",
        message: null,
        protocolSecret: "A".repeat(64)
      })),
      isDesktop: () => true
    });

    await expect(runtime.snapshot()).rejects.toThrow(
      "desktop protocol secret must be 64 lowercase hexadecimal characters"
    );
  });
});
