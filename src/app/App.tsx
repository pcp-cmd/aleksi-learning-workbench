import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useState } from "react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useBlocker,
  useLocation,
  useNavigate
} from "react-router-dom";
import { AppErrorBoundary } from "../components/ErrorBoundaries";
import { NavigationRail } from "../components/NavigationRail";
import { LaunchSplash } from "../features/entrance/LaunchSplash";
import {
  initialLaunchState,
  launchCanEnter,
  transitionLaunch
} from "../features/entrance/launch-machine";
import {
  consumeLaunchToken,
  desktopLaunchPresentationComplete,
  markDesktopLaunchPresentationComplete,
  readLaunchToken
} from "../features/entrance/launch-token";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { LibraryWriteBlockWarning } from "../features/settings/LibraryHealthSection";
import { desktopRuntime } from "../desktop/runtime";
import { setDesktopApiSession } from "../lib/api-client";
import {
  dismissDraftPersistenceWarning,
  useDraftPersistenceWarning
} from "../lib/draft-persistence-status";
import {
  beginUnsavedGuardSession,
  confirmDiscardUnsavedChanges,
  hasUnsavedChanges,
  shouldBlockUnsavedNavigation
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
import { readLastSafeRoute, writeLastSafeRoute } from "./route-restore";
import { PRIMARY_ROUTES } from "./route-registry";
import { WorkbenchRoutes } from "./routes";
import { SettingsProvider } from "./settings-context";
import { createApplicationClosePolicy } from "./application-close";

function UnsavedNavigationGuard() {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (
      currentLocation.pathname === nextLocation.pathname &&
      currentLocation.search === nextLocation.search &&
      currentLocation.hash === nextLocation.hash
    ) {
      return false;
    }
    return shouldBlockUnsavedNavigation(
      `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`
    );
  });

  useEffect(() => {
    if (blocker.state !== "blocked") {
      return;
    }
    if (confirmDiscardUnsavedChanges()) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  return null;
}

function WorkbenchShell() {
  useState(() => beginUnsavedGuardSession());
  const location = useLocation();
  const navigate = useNavigate();
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [libraryGeneration, setLibraryGeneration] = useState(0);
  const [closeFailure, setCloseFailure] = useState<string | null>(null);
  const [isClosing, setClosing] = useState(false);
  const draftWarning = useDraftPersistenceWarning();
  const [closePolicy] = useState(() =>
    createApplicationClosePolicy({
      confirmDiscard: confirmDiscardUnsavedChanges,
      forceRuntimeExit: desktopRuntime.forceExit,
      hasUnsavedChanges,
      isDesktop: desktopRuntime.isDesktop,
      onFailure: (message) => {
        setClosing(false);
        setCloseFailure(message);
      },
      requestRuntimeExit: async () => {
        setCloseFailure(null);
        setClosing(true);
        await desktopRuntime.requestExit();
      }
    })
  );
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const handleLibraryChanged = useCallback(() => {
    beginUnsavedGuardSession();
    setSettingsOpen(false);
    setLibraryGeneration((generation) => generation + 1);
    navigate("/today", { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (desktopRuntime.isDesktop()) {
      writeLastSafeRoute(window.localStorage, location.pathname, location.search);
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key === "ArrowLeft"
      ) {
        event.preventDefault();
        window.history.back();
        return;
      }
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
        void closePolicy.requestApplicationClose("keyboard");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [closePolicy, navigate]);

  useEffect(() => {
    if (!desktopRuntime.isDesktop()) {
      return undefined;
    }

    let active = true;
    let unlisten: (() => void) | null = null;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested(async (event) => {
          await closePolicy.handleNativeCloseRequested(event);
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
  }, [closePolicy]);

  return (
    <>
      <UnsavedNavigationGuard />
      <SettingsProvider value={openSettings}>
        <div className="workbench-shell">
          <LibraryWriteBlockWarning onOpenSettings={openSettings} />
          {isClosing && closeFailure === null ? (
            <div className="lifecycle-error" role="status">
              <span>正在安全关闭本地服务，请稍候…</span>
            </div>
          ) : null}
          {closeFailure === null ? null : (
            <div className="lifecycle-error" role="alert">
              <span>无法安全关闭本地服务：{closeFailure}</span>
              <button
                className="button button-ghost"
                onClick={() => {
                  setCloseFailure(null);
                  void closePolicy.requestApplicationClose("settings");
                }}
                type="button"
              >
                重试安全关闭
              </button>
              <button
                className="button button-ghost"
                onClick={() => {
                  if (
                    window.confirm(
                      "强制退出可能中断正在写入的数据。仅在安全关闭持续失败时使用。确定强制退出吗？"
                    )
                  ) {
                    setCloseFailure(null);
                    setClosing(true);
                    void closePolicy.requestForceExit().catch((caught: unknown) => {
                      setClosing(false);
                      setCloseFailure(
                        caught instanceof Error
                          ? caught.message
                          : "强制退出命令失败，应用仍保持打开。"
                      );
                    });
                  }
                }}
                type="button"
              >
                强制退出
              </button>
            </div>
          )}
          {draftWarning === null ? null : (
            <div className="lifecycle-error draft-warning" role="alert">
              <span>{draftWarning}</span>
              <button
                className="button button-ghost"
                onClick={dismissDraftPersistenceWarning}
                type="button"
              >
                知道了
              </button>
            </div>
          )}
          <NavigationRail
            onOpenSettings={openSettings}
            routes={PRIMARY_ROUTES}
          />
          <main className="workbench-main" id="workspace">
            <div className="route-frame">
              <WorkbenchRoutes key={libraryGeneration} />
            </div>
          </main>
          <SettingsDialog
            open={isSettingsOpen}
            onClose={() => setSettingsOpen(false)}
            onLibraryChanged={handleLibraryChanged}
            onRequestApplicationClose={() =>
              closePolicy.requestApplicationClose("settings")
            }
          />
        </div>
      </SettingsProvider>
    </>
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
  const [restoreTarget] = useState(() =>
    isDesktop ? readLastSafeRoute(window.localStorage) : "/today"
  );
  const [showSplash] = useState(() => {
    if (isDesktop) {
      return !desktopLaunchPresentationComplete(window.sessionStorage);
    }
    const token = readLaunchToken(
      `${window.location.pathname}${window.location.search}`
    );
    return token !== null && consumeLaunchToken(token, window.sessionStorage);
  });
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [launch, dispatch] = useReducer(
    transitionLaunch,
    undefined,
    () =>
      initialLaunchState({
        reducedMotion: reducedMotionRequested(),
        serviceReady: !isDesktop
      })
  );

  useEffect(() => {
    if (!showSplash || !isDesktop) {
      return undefined;
    }

    let cancelled = false;
    let pollTimer: number | null = null;
    setDesktopApiSession(null);

    const poll = async () => {
      try {
        const snapshot = await desktopRuntime.snapshot();
        if (cancelled) {
          return;
        }
        if (
          snapshot.mode === "ready" &&
          snapshot.apiBaseUrl !== null &&
          snapshot.protocolSecret !== null
        ) {
          setDesktopApiSession({
            apiBaseUrl: snapshot.apiBaseUrl,
            protocolSecret: snapshot.protocolSecret
          });
          dispatch({ type: "SERVICE_READY" });
          return;
        }
        setDesktopApiSession(null);
        if (
          snapshot.mode === "crashed" ||
          snapshot.mode === "stopped" ||
          snapshot.mode === "stop-failed"
        ) {
          dispatch({
            type: "SERVICE_FAILED",
            message: snapshot.message ?? "本地服务启动失败"
          });
          return;
        }
        pollTimer = window.setTimeout(() => void poll(), 120);
      } catch (error) {
        if (!cancelled) {
          setDesktopApiSession(null);
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
    if (showSplash && launchCanEnter(launch)) {
      if (isDesktop) {
        markDesktopLaunchPresentationComplete(window.sessionStorage);
      }
      navigate(restoreTarget, { replace: true });
    }
  }, [isDesktop, launch, navigate, restoreTarget, showSplash]);

  const retry = useCallback(() => {
    setDesktopApiSession(null);
    dispatch({ type: "RETRY_SERVICE" });
    void desktopRuntime
      .restartSidecar()
      .then(() => setRetryGeneration((generation) => generation + 1))
      .catch((error: unknown) => {
        setDesktopApiSession(null);
        dispatch({
          type: "SERVICE_FAILED",
          message: error instanceof Error ? error.message : "本地服务重启失败"
        });
      });
  }, []);
  const animationLoaded = useCallback(() => {
    dispatch({ type: "ANIMATION_PLAYING" });
  }, []);
  const animationCompleted = useCallback(() => {
    dispatch({ type: "ANIMATION_COMPLETED" });
  }, []);
  const animationUnavailable = useCallback(() => {
    dispatch({ type: "ANIMATION_UNAVAILABLE" });
  }, []);
  const reducedMotion = useCallback(() => {
    dispatch({ type: "REDUCED_MOTION" });
  }, []);
  const directEntry = useCallback(() => {
    dispatch({ type: "DIRECT_ENTRY_REQUESTED" });
  }, []);
  const safeExit = useCallback(() => {
    void desktopRuntime.requestExit().catch((error: unknown) => {
      dispatch({
        type: "SERVICE_FAILED",
        message:
          error instanceof Error ? error.message : "无法安全退出，请重试"
      });
    });
  }, []);

  if (!showSplash) {
    return <Navigate replace to={isDesktop ? restoreTarget : "/today"} />;
  }

  return (
    <LaunchSplash
      launch={launch}
      onAnimationComplete={animationCompleted}
      onAnimationLoaded={animationLoaded}
      onAnimationUnavailable={animationUnavailable}
      onDirectEntry={directEntry}
      onReducedMotion={reducedMotion}
      onRetry={retry}
      onSafeExit={isDesktop ? safeExit : undefined}
    />
  );
}

export function App() {
  const [router] = useState(() =>
    createBrowserRouter([
      { path: "/", element: <LaunchEntry /> },
      { path: "/*", element: <WorkbenchShell /> }
    ])
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <RouterProvider router={router} />
      </AppErrorBoundary>
    </QueryClientProvider>
  );
}
