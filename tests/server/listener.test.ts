import type { Server } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const startServerModulePath = "../../server/start-server";
const packageVersion = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
).version as string;

type StartServerModule = {
  formatDesktopReadyLine: (ready: {
    buildId: string;
    host: string;
    port: number;
    protocolVersion: number;
    shellBuildId: string;
    sidecarBuildId: string;
    version: string;
  }) => string;
  startDesktopParentWatchdog: (
    parentPid: number,
    options: {
      intervalMilliseconds?: number;
      onParentExit: () => void;
      processExists?: (pid: number) => boolean;
    }
  ) => () => void;
  startServer: (options: {
    desktopHandshake?: {
      protocolVersion: number;
      shellBuildId: string;
      sidecarBuildId: string;
    };
    port: number;
    startupRecovery?: () => Promise<unknown>;
    onListening?: (url: string) => void;
    onReady?: (ready: {
      buildId: string;
      host: string;
      port: number;
      protocolVersion: number;
      shellBuildId: string;
      sidecarBuildId: string;
      version: string;
    }) => void;
  }) => Server;
};

async function loadStartServer(): Promise<StartServerModule> {
  const startServerModule = await import(
    /* @vite-ignore */ startServerModulePath
  ).catch(() => undefined);

  if (!startServerModule) {
    expect.fail("server/start-server.ts is not implemented");
  }

  return startServerModule as StartServerModule;
}

describe("server listener", () => {
  it("stops a desktop sidecar when its direct shell parent disappears", async () => {
    vi.useFakeTimers();
    try {
      const { startDesktopParentWatchdog } = await loadStartServer();
      const onParentExit = vi.fn();
      const processExists = vi
        .fn<(pid: number) => boolean>()
        .mockReturnValueOnce(true)
        .mockReturnValue(false);
      const dispose = startDesktopParentWatchdog(4242, {
        intervalMilliseconds: 250,
        onParentExit,
        processExists
      });

      expect(processExists).toHaveBeenCalledWith(4242);
      await vi.advanceTimersByTimeAsync(250);
      expect(onParentExit).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onParentExit).toHaveBeenCalledTimes(1);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds an actual ephemeral listener to IPv4 loopback", async () => {
    const { startServer } = await loadStartServer();
    const server = startServer({ port: 0 });

    await once(server, "listening");

    try {
      const address = server.address();

      expect(address).not.toBeNull();
      expect(typeof address).not.toBe("string");

      if (address && typeof address !== "string") {
        expect(address.address).toBe("127.0.0.1");
        expect(address.address).not.toBe("0.0.0.0");
        expect(address.port).toBeGreaterThan(0);
      }
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("does not listen until startup transaction recovery completes", async () => {
    const { startServer } = await loadStartServer();
    let finishRecovery: (() => void) | undefined;
    const recovery = new Promise<void>((resolve) => {
      finishRecovery = resolve;
    });
    const server = startServer({
      port: 0,
      startupRecovery: () => recovery
    });
    const listening = once(server, "listening");

    expect(server.listening).toBe(false);
    finishRecovery?.();
    await listening;
    expect(server.listening).toBe(true);

    server.close();
    await once(server, "close");
  });

  it("reports the bound loopback port and build identity as a desktop readiness record", async () => {
    const { formatDesktopReadyLine, startServer } = await loadStartServer();
    let ready:
      | {
          buildId: string;
          host: string;
          port: number;
          protocolVersion: number;
          shellBuildId: string;
          sidecarBuildId: string;
          version: string;
        }
      | undefined;
    const server = startServer({
      desktopHandshake: {
        protocolVersion: 1,
        shellBuildId: "desktop-shell-build",
        sidecarBuildId: "sidecar-content-build"
      },
      port: 0,
      onReady: (nextReady) => {
        ready = nextReady;
      }
    });

    await once(server, "listening");

    try {
      expect(ready).toMatchObject({
        host: "127.0.0.1",
        port: expect.any(Number),
        version: packageVersion,
        buildId: "desktop-shell-build",
        protocolVersion: 1,
        shellBuildId: "desktop-shell-build",
        sidecarBuildId: "sidecar-content-build"
      });
      expect(formatDesktopReadyLine(ready!)).toBe(
        `ALEKSI_READY ${JSON.stringify(ready)}`
      );
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
