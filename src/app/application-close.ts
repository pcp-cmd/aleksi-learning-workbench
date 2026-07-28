export type ApplicationCloseSource =
  | "keyboard"
  | "native-window"
  | "settings";

export type ApplicationCloseOutcome =
  | "browser-ignored"
  | "cancelled"
  | "exited"
  | Readonly<{ status: "failed"; message: string }>;

type NativeCloseRequest = {
  preventDefault: () => void;
};

type ApplicationClosePolicyOptions = {
  confirmDiscard: () => boolean;
  hasUnsavedChanges: () => boolean;
  isDesktop: () => boolean;
  onFailure?: (message: string) => void;
  requestRuntimeExit: () => Promise<void>;
};

export function createApplicationClosePolicy(
  options: ApplicationClosePolicyOptions
) {
  let inFlight: Promise<ApplicationCloseOutcome> | null = null;

  const requestApplicationClose = (
    source: ApplicationCloseSource
  ): Promise<ApplicationCloseOutcome> => {
    if (inFlight !== null) {
      return inFlight;
    }

    inFlight = (async () => {
      if (!options.isDesktop()) {
        console.info("[lifecycle] browser close request ignored", { source });
        return "browser-ignored" as const;
      }

      const dirty = options.hasUnsavedChanges();
      if (dirty && !options.confirmDiscard()) {
        console.info("[lifecycle] application close cancelled", {
          dirty,
          source
        });
        return "cancelled" as const;
      }

      console.info("[lifecycle] application close approved", { dirty, source });
      try {
        await options.requestRuntimeExit();
        return "exited" as const;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "本地服务未能安全停止，应用仍保持打开。";
        options.onFailure?.(message);
        console.error("[lifecycle] application close failed", {
          message,
          source
        });
        return { status: "failed" as const, message };
      }
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  };

  const handleNativeCloseRequested = (
    event: NativeCloseRequest
  ): Promise<ApplicationCloseOutcome> => {
    if (!options.isDesktop()) {
      return Promise.resolve("browser-ignored");
    }

    event.preventDefault();
    return requestApplicationClose("native-window");
  };

  return { handleNativeCloseRequested, requestApplicationClose };
}
