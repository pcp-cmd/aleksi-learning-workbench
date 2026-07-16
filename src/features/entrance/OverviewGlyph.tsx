import { useEffect, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";

type OverviewGlyphState = "loading" | "ready" | "missing" | "reduced-motion";

type OverviewGlyphProps = {
  durationMs?: number;
  onComplete?: () => void;
  onLoaded?: () => void;
};

const OVERVIEW_MOTION_PATH = "/motion/overview.json";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function animationSpeed(animationData: unknown, durationMs: number): number {
  if (
    typeof animationData !== "object" ||
    animationData === null ||
    !("fr" in animationData) ||
    !("ip" in animationData) ||
    !("op" in animationData)
  ) {
    return 1;
  }

  const { fr, ip, op } = animationData as {
    fr: unknown;
    ip: unknown;
    op: unknown;
  };
  if (
    typeof fr !== "number" ||
    typeof ip !== "number" ||
    typeof op !== "number" ||
    !Number.isFinite(fr) ||
    !Number.isFinite(ip) ||
    !Number.isFinite(op) ||
    fr <= 0 ||
    op <= ip ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return 1;
  }

  const sourceDurationMs = ((op - ip) / fr) * 1_000;
  return Math.max(1, sourceDurationMs / durationMs);
}

export function OverviewGlyph({
  durationMs = 960,
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
        animation.setSpeed(animationSpeed(animationData, durationMs));
        animation.addEventListener("DOMLoaded", () => onLoaded?.());
        animation.addEventListener("complete", () => onComplete?.());
        setState("ready");
      } catch {
        if (!cancelled) {
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
  }, [durationMs, onComplete, onLoaded]);

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
