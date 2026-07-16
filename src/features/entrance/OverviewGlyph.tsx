import { useEffect, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";

type OverviewGlyphState = "loading" | "ready" | "missing" | "reduced-motion";

type OverviewGlyphProps = {
  onComplete?: () => void;
  onLoaded?: () => void;
};

const OVERVIEW_MOTION_PATH = "/motion/overview.json";
export const OVERVIEW_SOURCE_DURATION_MS = 20_000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function OverviewGlyph({
  onComplete,
  onLoaded
}: OverviewGlyphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<OverviewGlyphState>(() =>
    prefersReducedMotion() ? "reduced-motion" : "loading"
  );

  useEffect(() => {
    if (prefersReducedMotion()) {
      setState("reduced-motion");
      onLoaded?.();
      onComplete?.();
      return;
    }
    if (typeof fetch !== "function") {
      setState("missing");
      onLoaded?.();
      onComplete?.();
      return;
    }

    let cancelled = false;
    let animation: AnimationItem | null = null;

    async function loadMotion() {
      try {
        const response = await fetch(OVERVIEW_MOTION_PATH, { cache: "force-cache" });
        if (!response.ok) {
          throw new Error(`overview.json returned ${response.status}`);
        }

        const animationData = await response.json();
        const lottie = await import("lottie-web/build/player/lottie_light");

        if (cancelled || !containerRef.current) {
          return;
        }

        animation = lottie.default.loadAnimation({
          animationData,
          autoplay: true,
          container: containerRef.current,
          loop: false,
          renderer: "svg"
        });
        animation.setSpeed(1);
        animation.addEventListener("DOMLoaded", () => onLoaded?.());
        animation.addEventListener("complete", () => onComplete?.());
        setState("ready");
      } catch (error) {
        if (!cancelled) {
          console.error("Overview motion failed to load", error);
          setState("missing");
          onLoaded?.();
          onComplete?.();
        }
      }
    }

    void loadMotion();

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [onComplete, onLoaded]);

  return (
    <div
      aria-label="Overview glyph"
      className={`overview-glyph overview-glyph--${state}`}
      data-motion-state={state}
      role="img"
    >
      {state === "loading" || state === "ready" ? (
        <div
          aria-hidden="true"
          className="overview-glyph__viewport"
          ref={containerRef}
        />
      ) : (
        <div aria-hidden="true" className="overview-glyph__fallback">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  );
}
