import type { Server } from "node:http";
import { createApp } from "./app";
import {
  loadEnvFileIfPresent,
  parseDesktopServerPort,
  parseServerPort
} from "./runtime-config";
import { createRuntimeLifecycle } from "./runtime/lifecycle";

export const LOOPBACK_HOST = "127.0.0.1";

export type DesktopReadyRecord = {
  buildId: string;
  host: typeof LOOPBACK_HOST;
  port: number;
  version: string;
};

type StartServerOptions = {
  desktopCors?: boolean;
  port: number;
  staticDistDir?: string;
  onListening?: (url: string) => void;
  onReady?: (ready: DesktopReadyRecord) => void;
};

export function formatDesktopReadyLine(ready: DesktopReadyRecord): string {
  return `ALEKSI_READY ${JSON.stringify(ready)}`;
}

export function startServer({
  desktopCors = false,
  port,
  staticDistDir,
  onListening,
  onReady
}: StartServerOptions): Server {
  let server: Server;
  const runtimeLifecycle = createRuntimeLifecycle({
    onExitRequested: () => {
      const shutdown = setTimeout(() => {
        server.close();
      }, 25);
      shutdown.unref();
    }
  });
  server = createApp({ desktopCors, runtimeLifecycle, staticDistDir }).listen(port, LOOPBACK_HOST, () => {
    const address = server.address();
    const boundPort =
      address && typeof address !== "string" ? address.port : port;

    onListening?.(`http://${LOOPBACK_HOST}:${boundPort}`);
    onReady?.({
      host: LOOPBACK_HOST,
      port: boundPort,
      version: runtimeLifecycle.identity.version,
      buildId: runtimeLifecycle.identity.buildId
    });
  });

  return server;
}

export function runServer(): Server {
  loadEnvFileIfPresent();
  const desktopSidecar = process.env.ALEKSI_DESKTOP_SIDECAR === "1";
  const port = desktopSidecar
    ? parseDesktopServerPort(process.env.ALEKSI_SERVER_PORT)
    : parseServerPort(process.env.ALEKSI_SERVER_PORT);
  const staticDistDir = process.env.ALEKSI_STATIC_DIST_DIR;

  return startServer({
    desktopCors: desktopSidecar,
    port,
    staticDistDir,
    onListening: (url) => {
      if (!desktopSidecar) {
        console.log(`Aleksi local service: ${url}`);
      }
    },
    onReady: (ready) => {
      if (desktopSidecar) {
        console.log(formatDesktopReadyLine(ready));
      }
    }
  });
}
