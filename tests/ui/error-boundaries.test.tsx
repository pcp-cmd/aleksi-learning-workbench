// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppErrorBoundary,
  RouteErrorBoundary
} from "../../src/components/ErrorBoundaries";

function BrokenSurface(): never {
  throw new Error("render failed");
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("render recovery boundaries", () => {
  it("isolates a route render failure and keeps a recovery path visible", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <RouteErrorBoundary routeLabel="精读工作台">
        <BrokenSurface />
      </RouteErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("精读工作台暂时无法显示");
    expect(screen.getByRole("button", { name: "重试此页面" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回今日学习" })).toHaveAttribute(
      "href",
      "/today"
    );
  });

  it("shows a root recovery surface instead of a blank window", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <BrokenSurface />
      </AppErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("工作台暂时无法显示");
    expect(
      screen.getByRole("button", { name: "重新加载应用" })
    ).toBeInTheDocument();
  });
});
