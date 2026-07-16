// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewGlyph } from "../../src/features/entrance/OverviewGlyph";

const lottie = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  destroy: vi.fn(),
  loadAnimation: vi.fn(),
  setSpeed: vi.fn()
}));

vi.mock("lottie-web/build/player/lottie_light", () => ({
  default: {
    loadAnimation: lottie.loadAnimation
  }
}));

const OVERVIEW_ASSET_HINT =
  /将真实 overview\.json 放入 public\/motion\/overview\.json 后启用入口 glyph/;

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query === "(prefers-reduced-motion: reduce)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

function motionResponse() {
  return new Response(
    JSON.stringify({
      v: "5.12.2",
      fr: 60,
      ip: 0,
      op: 1,
      w: 240,
      h: 240,
      layers: []
    }),
    {
      headers: { "content-type": "application/json" },
      status: 200
    }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("OverviewGlyph", () => {
  beforeEach(() => {
    lottie.destroy.mockReset();
    lottie.addEventListener.mockReset();
    lottie.loadAnimation.mockReset();
    lottie.setSpeed.mockReset();
    lottie.loadAnimation.mockReturnValue({
      addEventListener: lottie.addEventListener,
      destroy: lottie.destroy,
      setSpeed: lottie.setSpeed
    });
  });

  it("loads the public overview motion asset without rendering the asset-instruction fallback", async () => {
    setReducedMotion(false);
    const fetchMock = vi.fn(async () => motionResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<OverviewGlyph />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/motion/overview.json",
        expect.objectContaining({ cache: "force-cache" })
      )
    );
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Overview glyph" })).toHaveAttribute(
        "data-motion-state",
        "ready"
      )
    );

    expect(screen.queryByText(OVERVIEW_ASSET_HINT)).not.toBeInTheDocument();
    expect(document.querySelector(".overview-glyph__viewport")).toBeInTheDocument();
    expect(lottie.loadAnimation).toHaveBeenCalledWith(
      expect.objectContaining({
        animationData: expect.objectContaining({ v: "5.12.2" }),
        autoplay: true,
        loop: false,
        renderer: "svg"
      })
    );
    expect(lottie.setSpeed).toHaveBeenCalledWith(1);
  });

  it("fits a long source animation into the requested launch duration", async () => {
    setReducedMotion(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ v: "5.12.2", fr: 12, ip: 0, op: 240, layers: [] }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      )
    );

    render(<OverviewGlyph durationMs={1_000} />);

    await waitFor(() => expect(lottie.setSpeed).toHaveBeenCalledWith(20));
  });

  it("falls back to a static glyph when the overview motion asset is unavailable", async () => {
    setReducedMotion(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));

    render(<OverviewGlyph />);

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Overview glyph" })).toHaveAttribute(
        "data-motion-state",
        "missing"
      )
    );

    expect(document.querySelector(".overview-glyph__fallback")).toBeInTheDocument();
  });

  it("uses a static reduced-motion glyph without fetching the animation", () => {
    setReducedMotion(true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<OverviewGlyph />);

    expect(screen.getByRole("img", { name: "Overview glyph" })).toHaveAttribute(
      "data-motion-state",
      "reduced-motion"
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(OVERVIEW_ASSET_HINT)).not.toBeInTheDocument();
    expect(document.querySelector(".overview-glyph__fallback")).toBeInTheDocument();
    expect(lottie.loadAnimation).not.toHaveBeenCalled();
  });
});
