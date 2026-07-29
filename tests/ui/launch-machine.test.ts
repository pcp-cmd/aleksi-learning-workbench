import { describe, expect, it } from "vitest";
import {
  initialLaunchState,
  launchCanEnter,
  transitionLaunch
} from "../../src/features/entrance/launch-machine";

describe("mandatory dual-path launch state machine", () => {
  it("S01 enters naturally only after the real animation completion and service readiness", () => {
    let state = initialLaunchState();
    state = transitionLaunch(state, { type: "ANIMATION_PLAYING" });
    state = transitionLaunch(state, { type: "SERVICE_READY" });

    expect(state).toMatchObject({
      animation: "playing",
      service: "ready"
    });
    expect(launchCanEnter(state)).toBe(false);

    state = transitionLaunch(state, { type: "ANIMATION_COMPLETED" });
    expect(launchCanEnter(state)).toBe(true);
  });

  it("S02-S03 retains direct entry while the service starts and enters only when it is ready", () => {
    let state = transitionLaunch(initialLaunchState(), {
      type: "DIRECT_ENTRY_REQUESTED"
    });

    expect(state).toMatchObject({
      directEntryRequested: true,
      service: "starting"
    });
    expect(launchCanEnter(state)).toBe(false);

    state = transitionLaunch(state, { type: "SERVICE_READY" });
    expect(launchCanEnter(state)).toBe(true);
  });

  it("S04 waits for the service when animation completion occurs first", () => {
    let state = transitionLaunch(initialLaunchState(), {
      type: "ANIMATION_COMPLETED"
    });

    expect(state).toMatchObject({
      animation: "complete",
      service: "starting"
    });
    expect(launchCanEnter(state)).toBe(false);

    state = transitionLaunch(state, { type: "SERVICE_READY" });
    expect(launchCanEnter(state)).toBe(true);
  });

  it.each([
    ["ANIMATION_UNAVAILABLE", "unavailable"],
    ["REDUCED_MOTION", "reduced"]
  ] as const)(
    "S05/S08 treats %s as a truthful completed visual gate",
    (event, animation) => {
      let state = transitionLaunch(initialLaunchState(), { type: event });
      expect(state.animation).toBe(animation);
      expect(launchCanEnter(state)).toBe(false);

      state = transitionLaunch(state, { type: "SERVICE_READY" });
      expect(launchCanEnter(state)).toBe(true);
    }
  );

  it("S06 keeps service failures visible and blocks both entry paths", () => {
    let state = transitionLaunch(
      transitionLaunch(initialLaunchState(), {
        type: "DIRECT_ENTRY_REQUESTED"
      }),
      {
        type: "SERVICE_FAILED",
        message: "本地服务启动失败"
      }
    );

    expect(state).toMatchObject({
      directEntryRequested: true,
      failure: "本地服务启动失败",
      service: "failed"
    });
    expect(launchCanEnter(state)).toBe(false);
  });

  it("S07 retries only the service and preserves completed visual/direct-entry state", () => {
    let state = transitionLaunch(
      transitionLaunch(
        transitionLaunch(initialLaunchState(), {
          type: "ANIMATION_COMPLETED"
        }),
        { type: "DIRECT_ENTRY_REQUESTED" }
      ),
      { type: "SERVICE_FAILED", message: "首次启动失败" }
    );

    state = transitionLaunch(state, { type: "RETRY_SERVICE" });
    expect(state).toEqual({
      animation: "complete",
      service: "starting",
      directEntryRequested: true,
      failure: null
    });

    state = transitionLaunch(state, { type: "SERVICE_READY" });
    expect(launchCanEnter(state)).toBe(true);
  });

  it("ignores stale animation events after a terminal visual fallback", () => {
    let state = transitionLaunch(initialLaunchState(), {
      type: "ANIMATION_UNAVAILABLE"
    });
    state = transitionLaunch(state, { type: "ANIMATION_PLAYING" });
    state = transitionLaunch(state, { type: "ANIMATION_COMPLETED" });

    expect(state.animation).toBe("unavailable");
  });
});
