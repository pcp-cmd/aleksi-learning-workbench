import type { LaunchState } from "./launch-machine";
import { OverviewGlyph } from "./OverviewGlyph";

type LaunchSplashProps = {
  launch: LaunchState;
  onAnimationComplete: () => void;
  onAnimationLoaded: () => void;
  onAnimationUnavailable: () => void;
  onDirectEntry: () => void;
  onReducedMotion: () => void;
  onRetry: () => void;
  onSafeExit?: () => void;
};

function launchStatus(launch: LaunchState): string {
  if (launch.service === "failed") {
    return launch.failure ?? "本地服务暂时不可用";
  }
  if (launch.directEntryRequested && launch.service === "starting") {
    return "正在准备本地服务…";
  }
  if (
    launch.service === "starting" &&
    (launch.animation === "complete" ||
      launch.animation === "unavailable" ||
      launch.animation === "reduced")
  ) {
    return "启动动画已完成，正在准备本地服务…";
  }
  if (launch.service === "ready") {
    return "本地学习库已就绪，正在完成启动动画…";
  }
  return "正在加载启动动画并准备本地服务…";
}

export function LaunchSplash({
  launch,
  onAnimationComplete,
  onAnimationLoaded,
  onAnimationUnavailable,
  onDirectEntry,
  onReducedMotion,
  onRetry,
  onSafeExit
}: LaunchSplashProps) {
  const failed = launch.service === "failed";

  return (
    <main
      aria-label="Aleksi Workbench 正在启动"
      className="launch-splash"
    >
      <section className="launch-splash__stage">
        <OverviewGlyph
          onComplete={onAnimationComplete}
          onLoaded={onAnimationLoaded}
          onReducedMotion={onReducedMotion}
          onUnavailable={onAnimationUnavailable}
        />
        <div className="launch-splash__copy">
          <p className="launch-splash__kicker">LOCAL LEARNING WORKSPACE</p>
          <h1>Aleksi Learning Workbench</h1>
          <p aria-live="polite" className="launch-splash__status">
            {launchStatus(launch)}
          </p>
          {!failed ? (
            <div
              aria-label="正在进入今日学习"
              className="launch-splash__progress"
              role="progressbar"
            >
              <span />
            </div>
          ) : null}
          <div className="launch-splash__actions">
            <button
              className="button button--primary launch-splash__direct"
              disabled={failed}
              onClick={onDirectEntry}
              type="button"
            >
              直接进入
            </button>
            {failed ? (
              <>
                <button className="button" onClick={onRetry} type="button">
                  重试本地服务
                </button>
                {onSafeExit ? (
                  <button className="button" onClick={onSafeExit} type="button">
                    安全退出
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
