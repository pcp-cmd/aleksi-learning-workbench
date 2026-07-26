import type { Server } from "node:http";
import { createApp } from "./app";
import {
  parseDesktopRuntimeConfig,
  parseServerPort
} from "./runtime-config";
import { createRuntimeLifecycle } from "./runtime/lifecycle";

export const LOOPBACK_HOST = "127.0.0.1";

export type DesktopReadyRecord = {
  buildId: string;
  host: typeof LOOPBACK_HOST;
  port: number;
  protocolVersion: number;
  shellBuildId: string;
  sidecarBuildId: string;
  version: string;
};

type StartServerOptions = {
  desktopHandshake?: {
    protocolVersion: number;
    shellBuildId: string;
    sidecarBuildId: string;
  };
  desktopProtocolSecret?: string;
  port: number;
  staticDistDir?: string;
  onListening?: (url: string) => void;
  onReady?: (ready: DesktopReadyRecord) => void;
};

type DesktopParentWatchdogOptions = {
  intervalMilliseconds?: number;
  onParentExit: () => void;
  processExists?: (pid: number) => boolean;
};

export function desktopParentProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
}

export function startDesktopParentWatchdog(
  parentPid: number,
  {
    intervalMilliseconds = 1_000,
    onParentExit,
    processExists = desktopParentProcessExists
  }: DesktopParentWatchdogOptions
): () => void {
  let stopped = false;
  const checkParent = () => {
    if (stopped || processExists(parentPid)) {
      return;
    }
    stopped = true;
    clearInterval(timer);
    onParentExit();
  };
  const timer = setInterval(checkParent, intervalMilliseconds);
  timer.unref();
  checkParent();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function formatDesktopReadyLine(ready: DesktopReadyRecord): string {
  return `ALEKSI_READY ${JSON.stringify(ready)}`;
}

export function startServer({
  desktopHandshake,
  desktopProtocolSecret,
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
  server = createApp({
    desktopProtocolSecret,
    runtimeLifecycle,
    staticDistDir
  }).listen(port, LOOPBACK_HOST, () => {
    const address = server.address();
    const boundPort =
      address && typeof address !== "string" ? address.port : port;

    onListening?.(`http://${LOOPBACK_HOST}:${boundPort}`);
    onReady?.({
      host: LOOPBACK_HOST,
      port: boundPort,
      version: runtimeLifecycle.identity.version,
      buildId: desktopHandshake?.shellBuildId ?? runtimeLifecycle.identity.buildId,
      protocolVersion: desktopHandshake?.protocolVersion ?? 1,
      shellBuildId:
        desktopHandshake?.shellBuildId ?? runtimeLifecycle.identity.buildId,
      sidecarBuildId:
        desktopHandshake?.sidecarBuildId ?? runtimeLifecycle.identity.buildId
    });
  });

  return server;
}

export function runServer(): Server {
  const desktopSidecar = process.env.ALEKSI_DESKTOP_SIDECAR === "1";
  const desktopConfig = desktopSidecar
    ? parseDesktopRuntimeConfig(process.env)
    : undefined;
  const port =
    desktopConfig?.port ?? parseServerPort(process.env.ALEKSI_SERVER_PORT);
  const staticDistDir = process.env.ALEKSI_STATIC_DIST_DIR;

  if (
    desktopConfig !== undefined &&
    desktopConfig.parentPid !== process.ppid
  ) {
    throw new Error(
      "ALEKSI_DESKTOP_PARENT_PID does not match the direct desktop shell parent"
    );
  }

  try {
    const server = startServer({
      desktopHandshake:
        desktopConfig === undefined
          ? undefined
          : {
              protocolVersion: Number(desktopConfig.protocolVersion),
              shellBuildId: desktopConfig.shellBuildId,
              sidecarBuildId: desktopConfig.sidecarBuildId
            },
      desktopProtocolSecret: desktopConfig?.protocolSecret,
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
    if (desktopConfig !== undefined) {
      startDesktopParentWatchdog(desktopConfig.parentPid, {
        onParentExit: () => {
          const forcedExit = setTimeout(() => process.exit(1), 2_000);
          forcedExit.unref();
          server.close(() => process.exit(0));
        }
      });
    }
    return server;
  } finally {
    if (desktopSidecar) {
      delete process.env.ALEKSI_PROTOCOL_SECRET;
    }
  }
}
