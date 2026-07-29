// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { queryClient } from "../../src/app/query-client";
import { writeLastSafeRoute } from "../../src/app/route-restore";

const desktopMocks = vi.hoisted(() => ({
  exportDiagnostics: vi.fn(),
  isDesktop: vi.fn(() => true),
  openLearningLibrary: vi.fn(),
  requestExit: vi.fn(),
  restartSidecar: vi.fn(),
  selectLearningLibrary: vi.fn(),
  selectReadingFile: vi.fn(),
  snapshot: vi.fn(async () => ({
    mode: "ready",
    apiBaseUrl: "http://127.0.0.1:43127",
    buildId: "desktop-route-test",
    message: null,
    protocolSecret: "a".repeat(64)
  }))
}));

const nativeWindowState = vi.hoisted(() => ({
  closeHandler: null as null | ((
    event: { preventDefault: () => void }
  ) => void | Promise<void>)
}));
const nativeWindowMocks = vi.hoisted(() => ({
  onCloseRequested: vi.fn(
    async (
      handler: (
        event: { preventDefault: () => void }
      ) => void | Promise<void>
    ) => {
      nativeWindowState.closeHandler = handler;
      return () => undefined;
    }
  )
}));

vi.mock("../../src/desktop/runtime", () => ({ desktopRuntime: desktopMocks }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: nativeWindowMocks.onCloseRequested
  })
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  queryClient.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.pushState({}, "", "/");
  desktopMocks.requestExit.mockReset();
  nativeWindowMocks.onCloseRequested.mockClear();
  nativeWindowState.closeHandler = null;
});

describe("desktop launch route restoration", () => {
  it("routes the registered Tauri close callback through runtime shutdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 }))
    );

    render(<App />);
    await waitFor(() =>
      expect(nativeWindowMocks.onCloseRequested).toHaveBeenCalledTimes(1)
    );

    const event = { preventDefault: vi.fn() };
    await nativeWindowState.closeHandler?.(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(desktopMocks.requestExit).toHaveBeenCalledTimes(1);
  });

  it("reopens the last safe route and context after the launch gates complete", async () => {
    writeLastSafeRoute(
      window.localStorage,
      "/graph",
      "?concept=%E7%A7%AF%E5%88%86&stage=boundary&debug=true"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 }))
    );
    window.history.pushState({}, "", "/");

    render(<App />);
    expect(screen.getByLabelText("Aleksi Workbench 正在启动")).toBeInTheDocument();

    await waitFor(() => expect(window.location.pathname).toBe("/graph"));
    expect(window.location.search).toBe(
      "?concept=%E7%A7%AF%E5%88%86&stage=boundary"
    );
    expect(screen.getByRole("heading", { name: "主题飞轮" })).toBeInTheDocument();
  });
});
