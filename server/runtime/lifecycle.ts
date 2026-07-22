import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { getAppSettingsDirectory } from "../config/app-settings";
import { hasErrorCode } from "../lib/error-code";
import { activeLearningLibrary } from "../persistence/library-context";
import {
  runtimeBuildIdentity,
  type BuildIdentity
} from "./build-identity";

const PACKAGED_RUNTIME_MODE = "friend-preview";
const DIAGNOSTIC_TAIL_BYTES = 8 * 1024;
const DIAGNOSTIC_LOG_NAMES = [
  "latest.log",
  "sidecar.stdout.log",
  "sidecar.stderr.log",
  "server.stdout.log",
  "server.stderr.log"
] as const;

export type RuntimeCapabilities = {
  mode: string;
  identity: BuildIdentity;
  openLearningLibrary: boolean;
  exportDiagnostics: boolean;
  exitWorkbench: boolean;
};

export type RuntimeDiagnosticReport = {
  generatedAt: string;
  identity: BuildIdentity;
  mode: string;
  health: {
    ok: true;
    service: "aleksi-workbench";
  };
  logs: Array<{
    name: string;
    tail: string;
  }>;
};

export interface RuntimeLifecycle {
  readonly capabilities: RuntimeCapabilities;
  readonly identity: BuildIdentity;
  createDiagnosticReport(): Promise<RuntimeDiagnosticReport>;
  openLearningLibrary(): Promise<void>;
  requestExit(): void;
}

export class RuntimeLifecycleError extends Error {
  readonly code = "RUNTIME_CAPABILITY_UNAVAILABLE";
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "RuntimeLifecycleError";
  }
}

type RuntimeLifecycleOptions = {
  activeLibrary?: () => Promise<string>;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  onExitRequested?: () => void;
  openPath?: (path: string) => Promise<void>;
  platform?: NodeJS.Platform;
};

function packagedRuntime(mode: string): boolean {
  return mode === PACKAGED_RUNTIME_MODE || mode === "tauri-desktop";
}

async function openInWindowsExplorer(path: string): Promise<void> {
  const child = spawn("explorer.exe", [path], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

function sanitizeDiagnosticText(text: string): string {
  return text
    .replace(/[A-Za-z]:\\[^\r\n]*/gu, "[local path]")
    .replace(/\\\\[^\\\r\n]+\\[^\r\n]*/gu, "[network path]")
    .replace(/file:\/\/\/[^\s"']+/giu, "[local file]");
}

async function readBoundedLogTail(
  directory: string,
  name: string
): Promise<string | null> {
  let handle;
  try {
    handle = await open(join(directory, name), "r");
    const information = await handle.stat();
    const length = Math.min(information.size, DIAGNOSTIC_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, information.size - length);
    return sanitizeDiagnosticText(buffer.toString("utf8"));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export function createRuntimeLifecycle(
  options: RuntimeLifecycleOptions = {}
): RuntimeLifecycle {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const identity = runtimeBuildIdentity(env);
  const mode = env.ALEKSI_RUNTIME_MODE ?? "development";
  const isPackagedRuntime = packagedRuntime(mode);
  const capabilities: RuntimeCapabilities = {
    mode,
    identity,
    openLearningLibrary: isPackagedRuntime && platform === "win32",
    exportDiagnostics: true,
    exitWorkbench: isPackagedRuntime
  };
  const resolveActiveLibrary = options.activeLibrary ?? activeLearningLibrary;
  const openPath = options.openPath ?? openInWindowsExplorer;
  const now = options.now ?? (() => new Date());
  const onExitRequested = options.onExitRequested ?? (() => undefined);

  return {
    capabilities,
    identity,
    async openLearningLibrary() {
      if (!capabilities.openLearningLibrary) {
        throw new RuntimeLifecycleError(
          "Opening the learning library is available only in the packaged Windows runtime"
        );
      }

      await openPath(await resolveActiveLibrary());
    },
    async createDiagnosticReport() {
      const logDirectory =
        env.ALEKSI_RUNTIME_LOG_DIR ?? getAppSettingsDirectory();
      const logs: RuntimeDiagnosticReport["logs"] = [];

      for (const name of DIAGNOSTIC_LOG_NAMES) {
        const tail = await readBoundedLogTail(logDirectory, name);
        if (tail !== null) {
          logs.push({ name, tail });
        }
      }

      return {
        generatedAt: now().toISOString(),
        identity,
        mode,
        health: {
          ok: true,
          service: "aleksi-workbench"
        },
        logs
      };
    },
    requestExit() {
      if (!capabilities.exitWorkbench) {
        throw new RuntimeLifecycleError(
          "Exiting the workbench is available only in the packaged runtime"
        );
      }

      onExitRequested();
    }
  };
}
