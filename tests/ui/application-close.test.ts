import { describe, expect, it, vi } from "vitest";
import { createApplicationClosePolicy } from "../../src/app/application-close";

function setup(options: { desktop?: boolean; dirty?: boolean } = {}) {
  const confirmDiscard = vi.fn(() => true);
  const requestRuntimeExit = vi.fn(async () => undefined);
  const policy = createApplicationClosePolicy({
    confirmDiscard,
    hasUnsavedChanges: () => options.dirty ?? false,
    isDesktop: () => options.desktop ?? true,
    requestRuntimeExit
  });
  return { confirmDiscard, policy, requestRuntimeExit };
}

describe("application close policy", () => {
  it("routes a clean native close through the controlled runtime shutdown", async () => {
    const { confirmDiscard, policy, requestRuntimeExit } = setup();
    const event = { preventDefault: vi.fn() };
    await expect(policy.handleNativeCloseRequested(event)).resolves.toBe(
      "exited"
    );
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(requestRuntimeExit).toHaveBeenCalledTimes(1);
  });

  it("prevents native close and keeps the application open when dirty close is cancelled", async () => {
    const { confirmDiscard, policy, requestRuntimeExit } = setup({ dirty: true });
    const event = { preventDefault: vi.fn() };
    confirmDiscard.mockReturnValue(false);
    await expect(policy.handleNativeCloseRequested(event)).resolves.toBe(
      "cancelled"
    );
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(requestRuntimeExit).not.toHaveBeenCalled();
  });

  it("prevents native close, confirms once, and exits once for dirty work", async () => {
    const { confirmDiscard, policy, requestRuntimeExit } = setup({ dirty: true });
    const event = { preventDefault: vi.fn() };
    await expect(policy.handleNativeCloseRequested(event)).resolves.toBe(
      "exited"
    );
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(requestRuntimeExit).toHaveBeenCalledTimes(1);
  });

  it("uses the same policy for Settings exit", async () => {
    const { confirmDiscard, policy, requestRuntimeExit } = setup({ dirty: true });
    await expect(policy.requestApplicationClose("settings")).resolves.toBe(
      "exited"
    );
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(requestRuntimeExit).toHaveBeenCalledTimes(1);
  });

  it("serializes competing close sources into one decision", async () => {
    let releaseExit: (() => void) | undefined;
    const confirmDiscard = vi.fn(() => true);
    const requestRuntimeExit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseExit = resolve;
        })
    );
    const policy = createApplicationClosePolicy({
      confirmDiscard,
      hasUnsavedChanges: () => true,
      isDesktop: () => true,
      requestRuntimeExit
    });

    const nativeEvent = { preventDefault: vi.fn() };
    const nativeClose = policy.handleNativeCloseRequested(nativeEvent);
    const keyboardClose = policy.requestApplicationClose("keyboard");
    releaseExit?.();

    await expect(Promise.all([nativeClose, keyboardClose])).resolves.toEqual([
      "exited",
      "exited"
    ]);
    expect(nativeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(requestRuntimeExit).toHaveBeenCalledTimes(1);
  });

  it("does not call the native exit primitive in browser mode", async () => {
    const { confirmDiscard, policy, requestRuntimeExit } = setup({
      desktop: false,
      dirty: true
    });
    await expect(policy.requestApplicationClose("settings")).resolves.toBe(
      "browser-ignored"
    );
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(requestRuntimeExit).not.toHaveBeenCalled();
  });
});
