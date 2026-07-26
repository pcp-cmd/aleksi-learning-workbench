export type ApplicationCloseSource =
  | "keyboard"
  | "native-window"
  | "settings";

export type ApplicationCloseOutcome =
  | "browser-ignored"
  | "cancelled"
  | "exited"
  | "native-default";

type NativeCloseRequest = {
  preventDefault: () => void;
};

type ApplicationClosePolicyOptions = {
  confirmDiscard: () => boolean;
  hasUnsavedChanges: () => boolean;
  isDesktop: () => boolean;
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
      await options.requestRuntimeExit();
      return "exited" as const;
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

    if (!options.hasUnsavedChanges()) {
      console.info("[lifecycle] clean native close uses default shutdown");
      return Promise.resolve("native-default");
    }

    event.preventDefault();
    return requestApplicationClose("native-window");
  };

  return { handleNativeCloseRequested, requestApplicationClose };
}
