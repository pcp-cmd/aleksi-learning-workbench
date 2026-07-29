// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { queryClient } from "../../src/app/query-client";
import {
  consumeLaunchToken,
  desktopLaunchPresentationComplete,
  launchState,
  markDesktopLaunchPresentationComplete,
  readLaunchToken
} from "../../src/features/entrance/launch-token";

type GlyphCallbacks = {
  onComplete?: () => void;
  onLoaded?: () => void;
  onReducedMotion?: () => void;
  onUnavailable?: () => void;
};

const glyph = vi.hoisted(() => ({
  props: null as GlyphCallbacks | null,
  renderCount: 0
}));

const desktopMocks = vi.hoisted(() => ({
  exportDiagnostics: vi.fn(),
  forceExit: vi.fn(),
  isDesktop: vi.fn(() => false),
  openLearningLibrary: vi.fn(),
  requestExit: vi.fn(async () => undefined),
  restartSidecar: vi.fn(async () => undefined),
  selectLearningLibrary: vi.fn(),
  selectReadingFile: vi.fn(),
  snapshot: vi.fn()
}));

vi.mock("../../src/features/entrance/OverviewGlyph", () => ({
  OVERVIEW_SOURCE_DURATION_MS: 20_000,
  OverviewGlyph: (props: GlyphCallbacks) => {
    glyph.props = props;
    glyph.renderCount += 1;
    return <div aria-label="Overview glyph" role="img" />;
  }
}));
vi.mock("../../src/desktop/runtime", () => ({ desktopRuntime: desktopMocks }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: vi.fn(async () => () => undefined)
  })
}));

function stubUnavailableBackend(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "本地服务暂时不可用" } }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" }
        }
      )
    )
  );
}

function readySnapshot() {
  return {
    mode: "ready" as const,
    apiBaseUrl: "http://127.0.0.1:43127",
    buildId: "launch-test",
    message: null,
    protocolSecret: "a".repeat(64)
  };
}

function startingSnapshot() {
  return {
    mode: "starting" as const,
    apiBaseUrl: null,
    buildId: "launch-test",
    message: "正在启动",
    protocolSecret: null
  };
}

beforeEach(() => {
  glyph.props = null;
  glyph.renderCount = 0;
  desktopMocks.isDesktop.mockReturnValue(false);
  desktopMocks.snapshot.mockReset();
  desktopMocks.restartSidecar.mockClear();
  desktopMocks.requestExit.mockClear();
  stubUnavailableBackend();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  queryClient.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.pushState({}, "", "/");
  document.body.innerHTML = "";
});

describe("one-launch splash", () => {
  it("S10 recognizes only safe root launch tokens and consumes each nonce once", () => {
    expect(launchState("/?launch=fresh-token", window.sessionStorage)).toEqual({
      show: true
    });
    expect(readLaunchToken("/today?launch=ignored")).toBeNull();
    expect(readLaunchToken("/?launch=unsafe%20token")).toBeNull();
    expect(consumeLaunchToken("fresh-token", window.sessionStorage)).toBe(true);
    expect(consumeLaunchToken("fresh-token", window.sessionStorage)).toBe(false);
    expect(launchState("/?launch=fresh-token", window.sessionStorage)).toEqual({
      show: false
    });
    expect(launchState("/today", window.sessionStorage)).toEqual({ show: false });
    expect(desktopLaunchPresentationComplete(window.sessionStorage)).toBe(false);
    markDesktopLaunchPresentationComplete(window.sessionStorage);
    expect(desktopLaunchPresentationComplete(window.sessionStorage)).toBe(true);

    const writeBlockedStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      })
    };
    expect(desktopLaunchPresentationComplete(writeBlockedStorage)).toBe(false);
    markDesktopLaunchPresentationComplete(writeBlockedStorage);
    expect(desktopLaunchPresentationComplete(writeBlockedStorage)).toBe(true);
  });

  it("S01 waits for the real Lottie completion callback instead of a timer", async () => {
    vi.useFakeTimers();
    window.history.pushState({}, "", "/?launch=natural-path");

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Aleksi Learning Workbench" })
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(window.location.pathname).toBe("/");

    await act(async () => {
      glyph.props?.onLoaded?.();
      glyph.props?.onComplete?.();
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/today");
  });

  it("S02 enters immediately when direct entry is requested after browser readiness", async () => {
    window.history.pushState({}, "", "/?launch=direct-ready");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "直接进入" }));

    await waitFor(() => expect(window.location.pathname).toBe("/today"));
  });

  it("S03 retains an early direct-entry request until the desktop service is ready", async () => {
    vi.useFakeTimers();
    desktopMocks.isDesktop.mockReturnValue(true);
    desktopMocks.snapshot
      .mockResolvedValueOnce(startingSnapshot())
      .mockResolvedValueOnce(readySnapshot());

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "直接进入" }));

    expect(window.location.pathname).toBe("/");
    expect(screen.getByText("正在准备本地服务…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/today");
  });

  it("S04 waits visibly for the desktop service after animation completion", async () => {
    vi.useFakeTimers();
    desktopMocks.isDesktop.mockReturnValue(true);
    desktopMocks.snapshot
      .mockResolvedValueOnce(startingSnapshot())
      .mockResolvedValueOnce(readySnapshot());

    render(<App />);
    await act(async () => {
      glyph.props?.onComplete?.();
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/");
    expect(
      screen.getByText("启动动画已完成，正在准备本地服务…")
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
      await Promise.resolve();
    });
    expect(window.location.pathname).toBe("/today");
  });

  it("S05 lets an unavailable animation release only the visual gate", async () => {
    window.history.pushState({}, "", "/?launch=missing-motion");
    render(<App />);

    await act(async () => {
      glyph.props?.onUnavailable?.();
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/today");
  });

  it("S06 keeps failure diagnostics, retry, safe exit, and direct entry visible", async () => {
    desktopMocks.isDesktop.mockReturnValue(true);
    desktopMocks.snapshot.mockResolvedValue({
      ...startingSnapshot(),
      mode: "crashed",
      message: "端口被占用"
    });

    render(<App />);

    expect(await screen.findByText("端口被占用")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重试本地服务" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "安全退出" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "直接进入" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "安全退出" }));
    expect(desktopMocks.requestExit).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/");
  });

  it("S06 treats native stop-failed as a recoverable terminal failure", async () => {
    desktopMocks.isDesktop.mockReturnValue(true);
    desktopMocks.snapshot.mockResolvedValue({
      ...startingSnapshot(),
      mode: "stop-failed",
      message: "旧服务未能安全停止"
    });

    render(<App />);

    expect(await screen.findByText("旧服务未能安全停止")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重试本地服务" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "安全退出" })).toBeInTheDocument();
  });

  it("S07 retries the service without requiring the completed visual gate to replay", async () => {
    vi.useFakeTimers();
    desktopMocks.isDesktop.mockReturnValue(true);
    desktopMocks.snapshot
      .mockResolvedValueOnce({
        ...startingSnapshot(),
        mode: "crashed",
        message: "首次启动失败"
      })
      .mockResolvedValueOnce(readySnapshot());

    render(<App />);
    await act(async () => {
      glyph.props?.onUnavailable?.();
      await Promise.resolve();
    });
    expect(screen.getByText("首次启动失败")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试本地服务" }));
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(desktopMocks.restartSidecar).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/today");
  });

  it("S08 uses a static reduced-motion gate and enters when ready", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    );
    window.history.pushState({}, "", "/?launch=reduced-motion");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/today"));
  });

  it("does not replay the entrance for a consumed token", () => {
    consumeLaunchToken("used-nonce", window.sessionStorage);
    window.history.pushState({}, "", "/?launch=used-nonce");
    render(<App />);

    expect(window.location.pathname).toBe("/today");
    expect(
      screen.queryByLabelText("Aleksi Workbench 正在启动")
    ).not.toBeInTheDocument();
  });

  it("S10 presents the desktop entrance only once per window session", async () => {
    desktopMocks.isDesktop.mockReturnValue(true);
    desktopMocks.snapshot.mockResolvedValue(readySnapshot());

    const first = render(<App />);
    await act(async () => {
      glyph.props?.onUnavailable?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(window.location.pathname).toBe("/today"));
    const renderCountAfterFirstEntrance = glyph.renderCount;

    first.unmount();
    window.history.pushState({}, "", "/");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/today"));
    expect(glyph.renderCount).toBe(renderCountAfterFirstEntrance);
    expect(
      screen.queryByLabelText("Aleksi Workbench 正在启动")
    ).not.toBeInTheDocument();
  });
});
