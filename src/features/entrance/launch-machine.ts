export type LaunchPhase =
  | "idle"
  | "loading-animation"
  | "playing"
  | "service-ready"
  | "complete"
  | "fallback";

export type LaunchState = {
  animationCompleted: boolean;
  animationLoaded: boolean;
  message: string | null;
  minimumElapsed: boolean;
  phase: LaunchPhase;
  serviceReady: boolean;
};

export type LaunchEvent =
  | { type: "BEGIN" }
  | { type: "ANIMATION_LOADED" }
  | { type: "ANIMATION_COMPLETED" }
  | { type: "SERVICE_READY" }
  | { type: "SERVICE_FAILED"; message: string }
  | { type: "MINIMUM_ELAPSED" }
  | { type: "MAXIMUM_ELAPSED" }
  | { type: "RETRY" };

export function initialLaunchState(
  options: { serviceReady?: boolean } = {}
): LaunchState {
  return {
    phase: "idle",
    animationLoaded: false,
    animationCompleted: false,
    minimumElapsed: false,
    serviceReady: options.serviceReady ?? false,
    message: null
  };
}

function settleLaunchState(state: LaunchState): LaunchState {
  if (state.message !== null) {
    return { ...state, phase: "fallback" };
  }
  if (
    state.minimumElapsed &&
    state.serviceReady
  ) {
    return { ...state, phase: "complete" };
  }
  if (state.serviceReady) {
    return { ...state, phase: "service-ready" };
  }
  if (state.animationLoaded) {
    return { ...state, phase: "playing" };
  }
  return { ...state, phase: "loading-animation" };
}

export function transitionLaunch(
  state: LaunchState,
  event: LaunchEvent
): LaunchState {
  switch (event.type) {
    case "BEGIN":
      return settleLaunchState(state);
    case "ANIMATION_LOADED":
      return settleLaunchState({ ...state, animationLoaded: true });
    case "ANIMATION_COMPLETED":
      return settleLaunchState({
        ...state,
        animationLoaded: true,
        animationCompleted: true
      });
    case "SERVICE_READY":
      return settleLaunchState({ ...state, serviceReady: true, message: null });
    case "SERVICE_FAILED":
      return settleLaunchState({ ...state, message: event.message });
    case "MINIMUM_ELAPSED":
      return settleLaunchState({ ...state, minimumElapsed: true });
    case "MAXIMUM_ELAPSED":
      return state.phase === "complete" || state.serviceReady
        ? state
        : settleLaunchState({
            ...state,
            message: "本地服务启动超时，请重试"
          });
    case "RETRY":
      return settleLaunchState({
        ...state,
        serviceReady: false,
        message: null
      });
  }
}
