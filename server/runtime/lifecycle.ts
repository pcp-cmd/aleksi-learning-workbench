import { spawn } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { getAppSettingsDirectory } from "../config/app-settings";
import { hasErrorCode } from "../lib/error-code";
import { activeLearningLibrary } from "../persistence/library-context";
import {
  runtimeBuildIdentity,
  type BuildIdentity
} from "./build-identity";
import {
  allowlistedDiagnosticMode,
  collectSensitiveEnvironmentValues,
  DIAGNOSTIC_LOG_NAMES,
  DIAGNOSTIC_TAIL_BYTES,
  runtimeDiagnosticReportSchema,
  sanitizeDiagnosticTail,
  type RuntimeDiagnosticReport
} from "./diagnostic-redaction";

export type { RuntimeDiagnosticReport } from "./diagnostic-redaction";

const PACKAGED_RUNTIME_MODE = "friend-preview";

export type RuntimeCapabilities = {
  mode: string;
  identity: BuildIdentity;
  openLearningLibrary: boolean;
  exportDiagnostics: boolean;
  exitWorkbench: boolean;
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
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (systemRoot === undefined || !isAbsolute(systemRoot)) {
    throw new Error("Windows system directory is unavailable");
  }
  const explorerPath = join(systemRoot, "explorer.exe");
  const explorer = await stat(explorerPath);
  if (!explorer.isFile()) {
    throw new Error("Windows Explorer is unavailable in the system directory");
  }
  const child = spawn(explorerPath, [path], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function readBoundedLogTail(
  directory: string,
  name: (typeof DIAGNOSTIC_LOG_NAMES)[number],
  knownSensitiveValues: readonly string[]
): Promise<string | null> {
  let handle;
  try {
    handle = await open(join(directory, name), "r");
    const information = await handle.stat();
    const length = Math.min(information.size, DIAGNOSTIC_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const offset = information.size - length;
    await handle.read(buffer, 0, length, offset);
    let text = buffer.toString("utf8");
    if (offset > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return sanitizeDiagnosticTail(text, knownSensitiveValues);
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
  const knownSensitiveValues = collectSensitiveEnvironmentValues(env);

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
        const tail = await readBoundedLogTail(
          logDirectory,
          name,
          knownSensitiveValues
        );
        if (tail !== null) {
          logs.push({ name, tail });
        }
      }

      return runtimeDiagnosticReportSchema.parse({
        generatedAt: now().toISOString(),
        identity,
        mode: allowlistedDiagnosticMode(mode),
        health: {
          ok: true,
          service: "aleksi-workbench"
        },
        logs
      });
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
