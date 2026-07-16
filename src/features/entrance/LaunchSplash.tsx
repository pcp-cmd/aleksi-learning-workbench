import type { LaunchPhase } from "./launch-machine";
import { OverviewGlyph } from "./OverviewGlyph";

type LaunchSplashProps = {
  durationMs: number;
  message: string | null;
  onAnimationComplete: () => void;
  onAnimationLoaded: () => void;
  onRetry: () => void;
  phase: LaunchPhase;
};

export function LaunchSplash({
  durationMs,
  message,
  onAnimationComplete,
  onAnimationLoaded,
  onRetry,
  phase
}: LaunchSplashProps) {
  return (
    <main
      aria-label="Aleksi Workbench 正在启动"
      className="launch-splash"
    >
      <section className="launch-splash__stage">
        <OverviewGlyph
          durationMs={durationMs}
          onComplete={onAnimationComplete}
          onLoaded={onAnimationLoaded}
        />
        <div className="launch-splash__copy">
          <p className="launch-splash__kicker">LOCAL LEARNING WORKSPACE</p>
          <h1>Aleksi Learning Workbench</h1>
          <p>
            {phase === "fallback"
              ? message ?? "本地服务暂时不可用"
              : phase === "service-ready"
                ? "本地学习库已就绪，正在完成启动动画…"
                : "正在整理今天的阅读、卡片与复习线索…"}
          </p>
          <div
            aria-label="正在进入今日学习"
            aria-valuemax={durationMs}
            aria-valuemin={0}
            className="launch-splash__progress"
            role="progressbar"
          >
            <span />
          </div>
          {phase === "fallback" ? (
            <button className="button launch-splash__retry" onClick={onRetry} type="button">
              重试本地服务
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
