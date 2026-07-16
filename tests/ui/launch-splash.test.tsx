// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { queryClient } from "../../src/app/query-client";
import {
  consumeLaunchToken,
  launchState,
  readLaunchToken
} from "../../src/features/entrance/launch-token";

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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  queryClient.clear();
  window.sessionStorage.clear();
  window.history.pushState({}, "", "/");
  document.body.innerHTML = "";
});

describe("one-launch splash", () => {
  it("recognizes only safe root launch tokens and consumes each nonce once", () => {
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
  });

  it("shows a bounded splash for a fresh nonce, then replaces it with Today", async () => {
    vi.useFakeTimers();
    stubUnavailableBackend();
    window.history.pushState({}, "", "/?launch=first-nonce");

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Aleksi Learning Workbench" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "进入学习器" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?launch=first-nonce");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(960);
    });

    expect(window.location.pathname).toBe("/today");
    expect(window.location.search).toBe("");
    expect(screen.getByRole("heading", { name: "今日学习" })).toBeInTheDocument();
  });

  it("skips consumed tokens and allows a second launcher nonce", () => {
    stubUnavailableBackend();
    consumeLaunchToken("used-nonce", window.sessionStorage);
    window.history.pushState({}, "", "/?launch=used-nonce");
    const first = render(<App />);
    expect(window.location.pathname).toBe("/today");
    expect(
      screen.queryByLabelText("Aleksi Workbench 正在启动")
    ).not.toBeInTheDocument();

    first.unmount();
    window.history.pushState({}, "", "/?launch=second-nonce");
    render(<App />);
    expect(
      screen.getByLabelText("Aleksi Workbench 正在启动")
    ).toBeInTheDocument();
  });

  it("uses the short bounded duration when reduced motion is requested", async () => {
    vi.useFakeTimers();
    stubUnavailableBackend();
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(119);
    });
    expect(window.location.pathname).toBe("/");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(window.location.pathname).toBe("/today");
  });
});
