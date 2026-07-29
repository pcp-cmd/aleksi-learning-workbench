import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { normalizeLoopbackApiBaseUrl } from "./loopback";

export type DesktopRuntimeMode =
  | "browser-development"
  | "starting"
  | "ready"
  | "stopping"
  | "stop-failed"
  | "crashed"
  | "stopped";

export type DesktopRuntimeSnapshot = {
  apiBaseUrl: string | null;
  buildId: string | null;
  message: string | null;
  mode: DesktopRuntimeMode;
  protocolSecret: string | null;
};

export type SelectedReading = {
  body: string;
  fileName: string;
  size: number;
};

type DesktopInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

type DesktopRuntimeOptions = {
  invoke: DesktopInvoke;
  isDesktop: () => boolean;
};

const DESKTOP_MODES = new Set<DesktopRuntimeMode>([
  "starting",
  "ready",
  "stopping",
  "stop-failed",
  "crashed",
  "stopped"
]);

function defaultDesktopDetection(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

function unavailable(): never {
  throw new Error("此操作仅在 Aleksi Workbench 桌面应用中可用");
}

function parseNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`桌面运行时返回了无效的 ${field}`);
  }
  return value;
}

function parseRuntimeSnapshot(value: unknown): DesktopRuntimeSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new Error("桌面运行时返回了无效的状态");
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.mode !== "string" ||
    !DESKTOP_MODES.has(record.mode as DesktopRuntimeMode)
  ) {
    throw new Error("桌面运行时返回了无效的状态");
  }

  const rawApiBaseUrl = parseNullableString(record.apiBaseUrl, "API 地址");
  const apiBaseUrl =
    rawApiBaseUrl === null ? null : normalizeLoopbackApiBaseUrl(rawApiBaseUrl);
  if (rawApiBaseUrl !== null && apiBaseUrl === null) {
    throw new Error("桌面运行时返回了无效的 API 地址");
  }
  if (record.mode === "ready" && apiBaseUrl === null) {
    throw new Error("桌面运行时已就绪但没有 API 地址");
  }
  const protocolSecret =
    record.protocolSecret === undefined
      ? null
      : parseNullableString(record.protocolSecret, "协议密钥");
  if (
    record.mode === "ready" &&
    protocolSecret === null
  ) {
    throw new Error("ready desktop runtime did not provide a protocol secret");
  }
  if (protocolSecret !== null && !/^[0-9a-f]{64}$/u.test(protocolSecret)) {
    throw new Error(
      "desktop protocol secret must be 64 lowercase hexadecimal characters"
    );
  }

  return {
    mode: record.mode as DesktopRuntimeMode,
    apiBaseUrl,
    buildId: parseNullableString(record.buildId, "构建标识"),
    message: parseNullableString(record.message, "状态信息"),
    protocolSecret
  };
}

function parseSelectedReading(value: unknown): SelectedReading | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    throw new Error("桌面文件选择返回了无效结果");
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.body !== "string" ||
    typeof record.fileName !== "string" ||
    typeof record.size !== "number" ||
    !Number.isSafeInteger(record.size) ||
    record.size < 0
  ) {
    throw new Error("桌面文件选择返回了无效结果");
  }

  return {
    body: record.body,
    fileName: record.fileName,
    size: record.size
  };
}

export function createDesktopRuntime(options: DesktopRuntimeOptions) {
  return {
    isDesktop: options.isDesktop,
    async snapshot(): Promise<DesktopRuntimeSnapshot> {
      if (!options.isDesktop()) {
        return {
          mode: "browser-development",
          apiBaseUrl: null,
          buildId: null,
          message: null,
          protocolSecret: null
        };
      }
      return parseRuntimeSnapshot(
        await options.invoke("desktop_runtime_snapshot")
      );
    },
    async restartSidecar(): Promise<void> {
      if (!options.isDesktop()) {
        unavailable();
      }
      await options.invoke("restart_sidecar");
    },
    async selectReadingFile(): Promise<SelectedReading | null> {
      if (!options.isDesktop()) {
        unavailable();
      }
      return parseSelectedReading(
        await options.invoke("select_reading_file")
      );
    },
    async selectLearningLibrary(): Promise<string | null> {
      if (!options.isDesktop()) {
        unavailable();
      }
      const result = await options.invoke("select_learning_library");
      if (result === null || typeof result === "string") {
        return result;
      }
      throw new Error("桌面目录选择返回了无效结果");
    },
    async openLearningLibrary(): Promise<void> {
      if (!options.isDesktop()) {
        unavailable();
      }
      await options.invoke("open_learning_library");
    },
    async exportDiagnostics(): Promise<string | null> {
      if (!options.isDesktop()) {
        unavailable();
      }
      const result = await options.invoke("export_diagnostics");
      if (result === null || typeof result === "string") {
        return result;
      }
      throw new Error("桌面诊断导出返回了无效结果");
    },
    async requestExit(): Promise<void> {
      if (!options.isDesktop()) {
        unavailable();
      }
      await options.invoke("request_exit");
    },
    async forceExit(): Promise<never> {
      if (!options.isDesktop()) {
        unavailable();
      }
      await options.invoke("force_exit");
      throw new Error(
        "Force-exit command returned while the application is still running"
      );
    }
  };
}

export const desktopRuntime = createDesktopRuntime({
  invoke: (command, args) => tauriInvoke<unknown>(command, args),
  isDesktop: defaultDesktopDetection
});
