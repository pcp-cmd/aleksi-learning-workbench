import { desktopRuntime, type DesktopRuntimeSnapshot } from "../desktop/runtime";
import { hasDesktopApiSession, setDesktopApiSession } from "../lib/api-client";

const POLL_INTERVAL_MS = 120;
let bootstrapPromise: Promise<void> | null = null;

function terminalFailure(snapshot: DesktopRuntimeSnapshot): Error | null {
  if (
    snapshot.mode !== "crashed" &&
    snapshot.mode !== "stopped" &&
    snapshot.mode !== "stop-failed"
  ) {
    return null;
  }
  return new Error(snapshot.message ?? "The desktop local service failed to start");
}

async function pollUntilReady(): Promise<void> {
  for (;;) {
    const snapshot = await desktopRuntime.snapshot();
    if (
      snapshot.mode === "ready" &&
      snapshot.apiBaseUrl !== null &&
      snapshot.protocolSecret !== null
    ) {
      setDesktopApiSession({
        apiBaseUrl: snapshot.apiBaseUrl,
        protocolSecret: snapshot.protocolSecret
      });
      return;
    }
    const failure = terminalFailure(snapshot);
    if (failure !== null) {
      throw failure;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export function ensureDesktopApiSession(): Promise<void> {
  if (!desktopRuntime.isDesktop() || hasDesktopApiSession()) {
    return Promise.resolve();
  }
  if (bootstrapPromise !== null) {
    return bootstrapPromise;
  }
  setDesktopApiSession(null);
  bootstrapPromise = pollUntilReady().catch((error: unknown) => {
    setDesktopApiSession(null);
    throw error;
  }).finally(() => {
    bootstrapPromise = null;
  });
  return bootstrapPromise;
}

export async function restartDesktopApiSession(): Promise<void> {
  setDesktopApiSession(null);
  await desktopRuntime.restartSidecar();
  await ensureDesktopApiSession();
}
