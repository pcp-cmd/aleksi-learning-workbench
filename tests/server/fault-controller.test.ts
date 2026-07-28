import { describe, expect, it, vi } from "vitest";
import { FaultController } from "../../server/testing/fault-controller";

describe("FaultController", () => {
  it("blocks at a named boundary until the test releases it", async () => {
    const controller = new FaultController();
    controller.install("card:before-commit", { kind: "block" });

    const operation = controller.boundary("card:before-commit");
    await controller.waitUntilReached("card:before-commit");

    expect(controller.snapshot()).toEqual(["card:before-commit"]);
    let completed = false;
    void operation.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    controller.release("card:before-commit");
    await expect(operation).resolves.toBeUndefined();
  });

  it("throws an injected error once the boundary is reached", async () => {
    const controller = new FaultController();
    const failure = new Error("simulated disk failure");
    controller.install("journal:after-prepare", {
      kind: "throw",
      error: failure
    });

    await expect(
      controller.boundary("journal:after-prepare")
    ).rejects.toBe(failure);
    await expect(
      controller.waitUntilReached("journal:after-prepare")
    ).resolves.toBeUndefined();
  });

  it("awaits an injected external edit callback", async () => {
    const controller = new FaultController();
    const externalEdit = vi.fn(async () => undefined);
    controller.install("card:before-cas", {
      kind: "callback",
      run: externalEdit
    });

    await controller.boundary("card:before-cas");

    expect(externalEdit).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toEqual(["card:before-cas"]);
  });

  it("lets tests wait before an unconfigured boundary is reached", async () => {
    const controller = new FaultController();
    const reached = controller.waitUntilReached("reading:after-write");

    await controller.boundary("reading:after-write");

    await expect(reached).resolves.toBeUndefined();
  });

  it("rejects duplicate installs and invalid releases", () => {
    const controller = new FaultController();
    controller.install("review:pending", { kind: "block" });

    expect(() =>
      controller.install("review:pending", { kind: "block" })
    ).toThrow(/already configured/u);
    expect(() => controller.release("missing")).toThrow(/not blocked/u);
  });
});
