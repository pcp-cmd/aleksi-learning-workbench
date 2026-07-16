import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate
} from "react-router-dom";
import { NavigationRail } from "../components/NavigationRail";
import { LaunchSplash } from "../features/entrance/LaunchSplash";
import {
  initialLaunchState,
  transitionLaunch
} from "../features/entrance/launch-machine";
import {
  consumeLaunchToken,
  readLaunchToken
} from "../features/entrance/launch-token";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { desktopRuntime } from "../desktop/runtime";
import { setApiBaseUrl } from "../lib/api-client";
import {
  beginUnsavedGuardSession,
  confirmDiscardUnsavedChanges
} from "../lib/unsaved-guard";
import "../styles/fonts.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/primitives.css";
import "../styles/components.css";
import "../styles/workbench.css";
import "../features/reader/reader.css";
import "../features/cards/cards.css";
import "../features/graph/flywheel.css";
import { queryClient } from "./query-client";
import { PRIMARY_ROUTES } from "./route-registry";
import { WorkbenchRoutes } from "./routes";

function WorkbenchShell() {
  useState(() => beginUnsavedGuardSession());
  const navigate = useNavigate();
  const [isSettingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      const key = event.key.toLocaleLowerCase();
      if (key === "o") {
        event.preventDefault();
        navigate(`/reader?import=${Date.now()}`);
      } else if (key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (key === "s") {
        event.preventDefault();
        window.dispatchEvent(new Event("aleksi:save-current"));
      } else if (key === "q" && desktopRuntime.isDesktop()) {
        event.preventDefault();
        if (confirmDiscardUnsavedChanges()) {
          void desktopRuntime.requestExit();
        }
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [navigate]);

  useEffect(() => {
    if (!desktopRuntime.isDesktop()) {
      return undefined;
    }

    let active = true;
    let unlisten: (() => void) | null = null;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested((event) => {
          event.preventDefault();
          if (confirmDiscardUnsavedChanges()) {
            void desktopRuntime.requestExit();
          }
        })
      )
      .then((dispose) => {
        if (active) {
          unlisten = dispose;
        } else {
          dispose();
        }
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return (
    <div className="workbench-shell">
      <NavigationRail
        onOpenSettings={() => setSettingsOpen(true)}
        routes={PRIMARY_ROUTES}
      />
      <main className="workbench-main" id="workspace">
        <div className="route-frame">
          <WorkbenchRoutes />
        </div>
      </main>
      <SettingsDialog
        open={isSettingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function reducedMotionRequested(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function LaunchEntry() {
  const navigate = useNavigate();
  const [isDesktop] = useState(() => desktopRuntime.isDesktop());
  const [showSplash] = useState(() => {
    if (desktopRuntime.isDesktop()) {
      return true;
    }
    const token = readLaunchToken(
      `${window.location.pathname}${window.location.search}`
    );
    return token !== null && consumeLaunchToken(token, window.sessionStorage);
  });
  const [durationMs] = useState(() =>
    reducedMotionRequested() ? 120 : 960
  );
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [launch, dispatch] = useReducer(
    transitionLaunch,
    undefined,
    () =>
      transitionLaunch(
        initialLaunchState({ serviceReady: !isDesktop }),
        { type: "BEGIN" }
      )
  );

  useEffect(() => {
    if (!showSplash) {
      return undefined;
    }
    const minimumTimer = window.setTimeout(
      () => dispatch({ type: "MINIMUM_ELAPSED" }),
      durationMs
    );
    const maximumTimer = isDesktop
      ? window.setTimeout(
          () => dispatch({ type: "MAXIMUM_ELAPSED" }),
          12_000
        )
      : null;
    return () => {
      window.clearTimeout(minimumTimer);
      if (maximumTimer !== null) {
        window.clearTimeout(maximumTimer);
      }
    };
  }, [durationMs, isDesktop, showSplash, retryGeneration]);

  useEffect(() => {
    if (!showSplash || !isDesktop) {
      return undefined;
    }

    let cancelled = false;
    let pollTimer: number | null = null;

    const poll = async () => {
      try {
        const snapshot = await desktopRuntime.snapshot();
        if (cancelled) {
          return;
        }
        if (snapshot.mode === "ready" && snapshot.apiBaseUrl !== null) {
          setApiBaseUrl(snapshot.apiBaseUrl);
          dispatch({ type: "SERVICE_READY" });
          return;
        }
        if (snapshot.mode === "crashed" || snapshot.mode === "stopped") {
          dispatch({
            type: "SERVICE_FAILED",
            message: snapshot.message ?? "本地服务启动失败"
          });
          return;
        }
        pollTimer = window.setTimeout(() => void poll(), 120);
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: "SERVICE_FAILED",
            message:
              error instanceof Error ? error.message : "无法读取本地服务状态"
          });
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [isDesktop, retryGeneration, showSplash]);

  useEffect(() => {
    if (launch.phase === "complete") {
      navigate("/today", { replace: true });
    }
  }, [launch.phase, navigate]);

  const retry = useCallback(() => {
    dispatch({ type: "RETRY" });
    void desktopRuntime
      .restartSidecar()
      .then(() => setRetryGeneration((generation) => generation + 1))
      .catch((error: unknown) => {
        dispatch({
          type: "SERVICE_FAILED",
          message: error instanceof Error ? error.message : "本地服务重启失败"
        });
      });
  }, []);
  const animationLoaded = useCallback(() => {
    dispatch({ type: "ANIMATION_LOADED" });
  }, []);
  const animationCompleted = useCallback(() => {
    dispatch({ type: "ANIMATION_COMPLETED" });
  }, []);

  if (!showSplash) {
    return <Navigate replace to="/today" />;
  }

  return (
    <LaunchSplash
      durationMs={durationMs}
      message={launch.message}
      onAnimationComplete={animationCompleted}
      onAnimationLoaded={animationLoaded}
      onRetry={retry}
      phase={launch.phase}
    />
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<LaunchEntry />} path="/" />
      <Route element={<WorkbenchShell />} path="/*" />
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
