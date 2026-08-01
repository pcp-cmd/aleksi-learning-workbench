export type LaunchAnimationState =
  | "loading"
  | "playing"
  | "complete"
  | "unavailable"
  | "reduced";

export type LaunchServiceState = "starting" | "ready" | "failed";

export type LaunchState = Readonly<{
  animation: LaunchAnimationState;
  service: LaunchServiceState;
  directEntryRequested: boolean;
  failure: string | null;
}>;

export type LaunchEvent =
  | { type: "ANIMATION_PLAYING" }
  | { type: "ANIMATION_COMPLETED" }
  | { type: "ANIMATION_UNAVAILABLE" }
  | { type: "REDUCED_MOTION" }
  | { type: "SERVICE_READY" }
  | { type: "SERVICE_FAILED"; message: string }
  | { type: "DIRECT_ENTRY_REQUESTED" }
  | { type: "RETRY_SERVICE" };

export function initialLaunchState(
  options: { reducedMotion?: boolean; serviceReady?: boolean } = {}
): LaunchState {
  return {
    animation: options.reducedMotion ? "reduced" : "loading",
    service: options.serviceReady ? "ready" : "starting",
    directEntryRequested: false,
    failure: null
  };
}

function visualGateIsTerminal(animation: LaunchAnimationState): boolean {
  return (
    animation === "complete" ||
    animation === "unavailable" ||
    animation === "reduced"
  );
}

export function launchCanEnter(state: LaunchState): boolean {
  return (
    state.service === "ready" &&
    (state.directEntryRequested || visualGateIsTerminal(state.animation))
  );
}

export function transitionLaunch(
  state: LaunchState,
  event: LaunchEvent
): LaunchState {
  switch (event.type) {
    case "ANIMATION_PLAYING":
      return state.animation === "loading"
        ? { ...state, animation: "playing" }
        : state;
    case "ANIMATION_COMPLETED":
      return visualGateIsTerminal(state.animation)
        ? state
        : { ...state, animation: "complete" };
    case "ANIMATION_UNAVAILABLE":
      return visualGateIsTerminal(state.animation)
        ? state
        : { ...state, animation: "unavailable" };
    case "REDUCED_MOTION":
      return { ...state, animation: "reduced" };
    case "SERVICE_READY":
      return { ...state, service: "ready", failure: null };
    case "SERVICE_FAILED":
      return {
        ...state,
        service: "failed",
        failure: event.message
      };
    case "DIRECT_ENTRY_REQUESTED":
      return { ...state, directEntryRequested: true };
    case "RETRY_SERVICE":
      return { ...state, service: "starting", failure: null };
  }
}
