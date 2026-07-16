import { describe, expect, it, vi } from "vitest";
import {
  createDesktopRuntime,
  type DesktopRuntimeSnapshot
} from "../../src/desktop/runtime";

const readySnapshot: DesktopRuntimeSnapshot = {
  mode: "ready",
  apiBaseUrl: "http://127.0.0.1:43127",
  buildId: "desktop-test-build",
  message: null
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
      message: null
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
        message: null
      })),
      isDesktop: () => true
    });

    await expect(runtime.snapshot()).rejects.toThrow(
      "桌面运行时返回了无效的 API 地址"
    );
  });
});
