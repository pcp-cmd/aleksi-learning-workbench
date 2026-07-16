import { describe, expect, it } from "vitest";
import {
  initialLaunchState,
  transitionLaunch
} from "../../src/features/entrance/launch-machine";

describe("desktop launch state machine", () => {
  it("requires animation, minimum duration, and service readiness", () => {
    let state = transitionLaunch(initialLaunchState(), { type: "BEGIN" });
    expect(state.phase).toBe("loading-animation");

    state = transitionLaunch(state, { type: "ANIMATION_LOADED" });
    expect(state.phase).toBe("playing");

    state = transitionLaunch(state, { type: "SERVICE_READY" });
    expect(state.phase).toBe("service-ready");

    state = transitionLaunch(state, { type: "MINIMUM_ELAPSED" });
    expect(state.phase).toBe("service-ready");

    state = transitionLaunch(state, { type: "ANIMATION_COMPLETED" });
    expect(state.phase).toBe("complete");
  });

  it("enters a retryable fallback on failure or maximum duration", () => {
    const playing = transitionLaunch(
      transitionLaunch(initialLaunchState(), { type: "BEGIN" }),
      { type: "ANIMATION_LOADED" }
    );
    const failed = transitionLaunch(playing, {
      type: "SERVICE_FAILED",
      message: "本地服务启动失败"
    });
    expect(failed).toMatchObject({
      phase: "fallback",
      message: "本地服务启动失败"
    });

    const retrying = transitionLaunch(failed, { type: "RETRY" });
    expect(retrying).toMatchObject({
      phase: "playing",
      message: null,
      serviceReady: false
    });

    expect(
      transitionLaunch(retrying, { type: "MAXIMUM_ELAPSED" })
    ).toMatchObject({
      phase: "fallback",
      message: "本地服务启动超时，请重试"
    });
  });

  it("allows browser development to begin with service readiness satisfied", () => {
    let state = transitionLaunch(initialLaunchState({ serviceReady: true }), {
      type: "BEGIN"
    });
    state = transitionLaunch(state, { type: "ANIMATION_LOADED" });
    state = transitionLaunch(state, { type: "ANIMATION_COMPLETED" });
    expect(state.phase).toBe("service-ready");
    state = transitionLaunch(state, { type: "MINIMUM_ELAPSED" });
    expect(state.phase).toBe("complete");
  });
});
