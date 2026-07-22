import type { Server } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const startServerModulePath = "../../server/start-server";
const packageVersion = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
).version as string;

type StartServerModule = {
  formatDesktopReadyLine: (ready: {
    buildId: string;
    host: string;
    port: number;
    version: string;
  }) => string;
  startServer: (options: {
    port: number;
    onListening?: (url: string) => void;
    onReady?: (ready: {
      buildId: string;
      host: string;
      port: number;
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

  it("reports the bound loopback port and build identity as a desktop readiness record", async () => {
    const { formatDesktopReadyLine, startServer } = await loadStartServer();
    let ready:
      | { buildId: string; host: string; port: number; version: string }
      | undefined;
    const server = startServer({
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
        buildId: expect.stringMatching(/^[a-z0-9.-]+$/u)
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
