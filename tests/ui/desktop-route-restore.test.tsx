// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
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
    message: null
  }))
}));

vi.mock("../../src/desktop/runtime", () => ({ desktopRuntime: desktopMocks }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: vi.fn(async () => () => undefined) })
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  queryClient.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.pushState({}, "", "/");
});

describe("desktop launch route restoration", () => {
  it("reopens the last safe route and context after the launch gates complete", async () => {
    vi.useFakeTimers();
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(960);
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/graph");
    expect(window.location.search).toBe(
      "?concept=%E7%A7%AF%E5%88%86&stage=boundary"
    );
    expect(screen.getByRole("heading", { name: "主题飞轮" })).toBeInTheDocument();
  });
});
